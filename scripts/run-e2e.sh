#!/bin/bash
# Run E2E tests with a dedicated test Strapi instance
#
# This script:
# 1. Starts Strapi on port 1338 with the test database
# 2. Waits for Strapi to be ready
# 3. Runs E2E tests
# 4. Shuts down the test Strapi instance

set -e

TEST_PORT=${TEST_PORT:-1338}
TEST_DB=${TEST_DB_NAME:-strapi_test}
STRAPI_URL="http://localhost:$TEST_PORT"
MAX_WAIT=120  # seconds

# Prefer Node 22 (project .nvmrc) when available.
NODE_VERSION=${NODE_VERSION:-22}
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # nvm doesn't work with npm_config_prefix (set by Homebrew/linuxbrew)
  unset npm_config_prefix
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
fi

kill_port_if_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    if lsof -i :"$TEST_PORT" > /dev/null 2>&1; then
      echo "⚠️  Port $TEST_PORT is in use. Stopping existing process..."
      lsof -ti :"$TEST_PORT" | xargs -r kill -9 2>/dev/null || true
      sleep 1
      echo "✅ Cleared port $TEST_PORT"
    fi
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser -n tcp "$TEST_PORT" > /dev/null 2>&1; then
      echo "⚠️  Port $TEST_PORT is in use. Stopping existing process..."
      fuser -k -n tcp "$TEST_PORT" > /dev/null 2>&1 || true
      sleep 1
      echo "✅ Cleared port $TEST_PORT"
    fi
  fi
}

echo "🧪 Starting E2E test suite..."
echo "   Port: $TEST_PORT"
echo "   Database: $TEST_DB"
echo "   Node: ${NODE_VERSION} (via nvm if available)"
echo ""

# Kill any process using the test port
kill_port_if_in_use

# Start Strapi in background with test database
# Note: Strapi uses DATABASE_NAME env var (see config/database.ts)
# Use 'start' mode (not 'develop') to avoid file-watching restarts during tests
if command -v nvm >/dev/null 2>&1; then
  # IMPORTANT: don't use `nvm exec ... &` because killing that PID may not kill
  # the spawned Node process. Instead, switch Node in this shell and start Strapi
  # normally so STRAPI_PID tracks the real process.
  nvm use "$NODE_VERSION" >/dev/null
fi

echo "🔨 Building Strapi..."
NODE_ENV=production npm run build

echo "🚀 Starting Strapi with test database (production mode - no file watching)..."
PORT=$TEST_PORT DATABASE_NAME=$TEST_DB NODE_ENV=production npm run start &
STRAPI_PID=$!

# Cleanup function to stop Strapi on exit
cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  if kill -0 $STRAPI_PID 2>/dev/null; then
    kill $STRAPI_PID 2>/dev/null || true
    wait $STRAPI_PID 2>/dev/null || true
  fi
  # Ensure the port is free even if the process spawned children.
  kill_port_if_in_use
  echo "✅ Test Strapi instance stopped"
}
trap cleanup EXIT

# Wait for Strapi to be ready
echo "⏳ Waiting for Strapi to be ready..."
SECONDS_WAITED=0
while [ $SECONDS_WAITED -lt $MAX_WAIT ]; do
  if curl -s "$STRAPI_URL/api/game-fetcher/status" > /dev/null 2>&1; then
    echo "✅ Strapi is ready!"
    break
  fi
  sleep 2
  SECONDS_WAITED=$((SECONDS_WAITED + 2))
  echo "   Waiting... ($SECONDS_WAITED/$MAX_WAIT seconds)"
done

if [ $SECONDS_WAITED -ge $MAX_WAIT ]; then
  echo "❌ Strapi failed to start within $MAX_WAIT seconds"
  exit 1
fi

echo ""
echo "🧪 Running E2E tests..."
echo ""

# Run E2E tests
STRAPI_TEST_URL=$STRAPI_URL RUN_E2E_TESTS=true npm run test:e2e -- "$@"
TEST_EXIT_CODE=$?

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ E2E tests passed!"
else
  echo "❌ E2E tests failed (exit code: $TEST_EXIT_CODE)"
fi

exit $TEST_EXIT_CODE

