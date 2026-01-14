#!/bin/bash
# Run E2E tests with a dedicated test Strapi instance
#
# This script:
# 1. Checks if AI SDK DevTools is already running (http://localhost:4983)
#    - If yes, reuses the existing instance
#    - If no, starts a new instance
# 2. Starts Strapi on port 1338 with the test database
# 3. Waits for Strapi to be ready
# 4. Runs E2E tests
# 5. Shuts down Strapi instance
# 6. Only stops DevTools if it started it (leaves existing instances running)

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

check_port_in_use() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$port" > /dev/null 2>&1
    return $?
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" > /dev/null 2>&1
    return $?
  fi
  return 1
}

kill_port_if_in_use() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    if lsof -i :"$port" > /dev/null 2>&1; then
      echo "⚠️  Port $port is in use. Stopping existing process..."
      lsof -ti :"$port" | xargs -r kill -9 2>/dev/null || true
      sleep 1
      echo "✅ Cleared port $port"
    fi
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser -n tcp "$port" > /dev/null 2>&1; then
      echo "⚠️  Port $port is in use. Stopping existing process..."
      fuser -k -n tcp "$port" > /dev/null 2>&1 || true
      sleep 1
      echo "✅ Cleared port $port"
    fi
  fi
}

echo "🧪 Starting E2E test suite..."
echo "   Port: $TEST_PORT"
echo "   Database: $TEST_DB"
echo "   Node: ${NODE_VERSION} (via nvm if available)"
echo ""

# Check if DevTools is already running (don't kill it if it is)
DEVTOOLS_ALREADY_RUNNING=false
DEVTOOLS_PID=""
if check_port_in_use 4983; then
  echo "🔧 AI SDK DevTools already running on port 4983, reusing existing instance..."
  DEVTOOLS_ALREADY_RUNNING=true
else
  echo "🔧 AI SDK DevTools not running, will start new instance..."
fi

# Kill any process using the Strapi test port (but not DevTools if it's already running)
kill_port_if_in_use "$TEST_PORT"  # Strapi test port

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

# Start AI SDK DevTools viewer (if not already running)
if [ "$DEVTOOLS_ALREADY_RUNNING" = "false" ]; then
  echo "🔧 Starting AI SDK DevTools viewer..."
  # Use nohup to ensure the process survives and redirect output
  nohup npx @ai-sdk/devtools > /tmp/ai-sdk-devtools.log 2>&1 &
  DEVTOOLS_PID=$!
  sleep 3  # Give DevTools a moment to start
  # Check if DevTools started successfully
  if kill -0 $DEVTOOLS_PID 2>/dev/null; then
    echo "   ✓ DevTools viewer running at http://localhost:4983"
  else
    echo "   ⚠️  Warning: DevTools viewer may have failed to start (PID: $DEVTOOLS_PID)"
    DEVTOOLS_PID=""  # Clear PID if it failed
  fi
else
  echo "   ✓ Using existing DevTools viewer at http://localhost:4983"
fi

echo "🚀 Starting Strapi with test database (production mode - no file watching)..."
# Always enable AI SDK DevTools middleware for E2E tests
# Use NODE_ENV=development to allow DevTools (which blocks production mode)
# Even though we use 'start' command, we set NODE_ENV=development for DevTools compatibility
PORT=$TEST_PORT DATABASE_NAME=$TEST_DB NODE_ENV=development RUN_E2E_TESTS=true AI_SDK_ENABLE_DEVTOOLS=true npm run start &
STRAPI_PID=$!

# Cleanup function to stop DevTools and Strapi on exit
cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  # Only stop DevTools if we started it ourselves
  if [ -n "$DEVTOOLS_PID" ] && kill -0 $DEVTOOLS_PID 2>/dev/null; then
    kill $DEVTOOLS_PID 2>/dev/null || true
    wait $DEVTOOLS_PID 2>/dev/null || true
    echo "✅ AI SDK DevTools stopped"
  elif [ "$DEVTOOLS_ALREADY_RUNNING" = "true" ]; then
    echo "ℹ️  Leaving existing DevTools instance running (was already running)"
  fi
  if kill -0 $STRAPI_PID 2>/dev/null; then
    kill $STRAPI_PID 2>/dev/null || true
    wait $STRAPI_PID 2>/dev/null || true
  fi
  # Ensure the Strapi port is free even if the process spawned children.
  # Don't kill DevTools port if we didn't start it.
  kill_port_if_in_use "$TEST_PORT"
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

