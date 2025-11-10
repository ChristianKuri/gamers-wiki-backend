# CI/CD Pipeline Setup Guide

## Overview

This guide will walk you through setting up a complete CI/CD pipeline for your Strapi v5 application. The pipeline will automatically build Docker images on GitHub Actions and deploy them to your ARM64 server via Portainer.

---

## ✅ What Has Been Created

### 1. GitHub Actions Workflow
**Location:** `.github/workflows/main.yml`

This workflow:
- ✅ Triggers on every push to the `main` branch
- ✅ Builds a Docker image specifically for `linux/arm64` platform
- ✅ Pushes the image to GitHub Container Registry (GHCR)
- ✅ Triggers your Portainer webhook to auto-deploy

### 2. Updated docker-compose.yml
**Location:** `docker-compose.yml`

Changes made:
- ✅ Removed `build: .` directive
- ✅ Added `image: ghcr.io/christiankuri/gamers-wiki-backend:latest`
- ✅ Added `pull_policy: always`
- ✅ Removed `DOCKER_BUILDKIT: 0` environment variable (no longer needed)

---

## 🔧 Configuration Steps

Follow these steps in order to complete your CI/CD setup.

### Step 1: Create GitHub Personal Access Token (PAT)

1. Go to your GitHub profile: **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Configure the token:
   - **Note:** `GHCR_Push_Token_for_Strapi` (or any descriptive name)
   - **Expiration:** Choose your preferred expiration (90 days recommended)
   - **Scopes:** Check **ONLY** the `write:packages` scope
     - This allows GitHub Actions to push Docker images to GHCR
4. Click **"Generate token"** at the bottom
5. **⚠️ IMPORTANT:** Copy the token immediately (it won't be shown again)

---

### Step 2: Add GitHub Repository Secrets

1. Navigate to your repository: `https://github.com/ChristianKuri/gamers-wiki-backend`
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Create the first secret:
   - **Name:** `DOCKER_PASSWORD`
   - **Value:** Paste the Personal Access Token you just created
   - Click **"Add secret"**

> **Note:** You'll add the second secret (`PORTAINER_WEBHOOK`) after Step 4.

---

### Step 3: Make Your GHCR Package Public (Important!)

By default, GitHub Container Registry packages are private. You need to make it public so your server can pull the image without authentication.

1. Go to your GitHub profile page
2. Click on **"Packages"** tab
3. After your first push to `main` (which will trigger the workflow), you'll see a package named `gamers-wiki-backend`
4. Click on the package
5. Click **"Package settings"** (on the right sidebar)
6. Scroll down to **"Danger Zone"**
7. Click **"Change visibility"** → Select **"Public"** → Confirm

> **Note:** You can only do this after the package is created (after your first successful workflow run).

---

### Step 4: Update Your Portainer Stack

1. Log into your Portainer instance
2. Navigate to **Stacks**
3. Find and click on your `gamers-wiki-stack` (or whatever you named it)
4. Click **"Editor"** tab
5. You have two options:

   **Option A: Manual Update (Immediate)**
   - Copy the entire contents of your new `docker-compose.yml` file
   - Paste it into the Portainer editor
   - Click **"Update the stack"**
   - Click the **"Pull and redeploy"** checkbox
   - Click **"Update"**

   **Option B: Git Deployment (Recommended for long-term)**
   - If you're using Portainer's Git deployment feature:
     1. Commit and push your updated `docker-compose.yml` to GitHub
     2. In Portainer, click **"Pull and redeploy"**
     3. Portainer will fetch the new compose file from Git
     4. Make sure Portainer is configured to pull from the `main` branch

> **⚠️ First Deployment Note:** The first time you update the stack, it might show an error because the image doesn't exist yet in GHCR. This is expected! Continue to the next step.

---

### Step 5: Get the Portainer Webhook URL

1. In Portainer, navigate to **Stacks**
2. Click on your `gamers-wiki-stack`
3. Look for the **"Webhook"** section (usually on the right side or in a tab)
4. You should see a webhook URL that looks like:
   ```
   https://your-portainer-domain.com/api/stacks/webhooks/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```
5. Click the **"Copy to clipboard"** icon next to the webhook URL

> **Alternative Method:** If you don't see a webhook option for the stack:
> 1. Navigate to **Services** instead
> 2. Click on the **`gamers-wiki-strapi`** service
> 3. Look for **"Service webhooks"** or **"Webhook"** section
> 4. Find the **"Re-pull image and redeploy"** webhook
> 5. Copy that webhook URL

---

### Step 6: Add Portainer Webhook to GitHub Secrets

1. Go back to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Create the second secret:
   - **Name:** `PORTAINER_WEBHOOK`
   - **Value:** Paste the webhook URL from Portainer
   - Click **"Add secret"**

---

## 🚀 Testing Your Pipeline

You're now ready to test the complete CI/CD pipeline!

### Trigger Your First Deployment

1. Make a small change to your repository (or create an empty commit):
   ```bash
   git commit --allow-empty -m "Test CI/CD pipeline"
   git push origin main
   ```

2. Watch the workflow run:
   - Go to your GitHub repository
   - Click the **"Actions"** tab
   - You should see a workflow run named "CI/CD Build and Push Strapi Image"
   - Click on it to watch the progress

3. The workflow will:
   - ✅ Checkout your code
   - ✅ Set up multi-platform build tools
   - ✅ Login to GHCR
   - ✅ Build your Strapi Docker image for ARM64
   - ✅ Push the image to `ghcr.io/christiankuri/gamers-wiki-backend:latest`
   - ✅ Trigger the Portainer webhook

4. Check Portainer:
   - Your stack should automatically pull the new image and redeploy
   - Check the logs to ensure Strapi started successfully

---

## 🔍 Troubleshooting

### Issue: Workflow fails at "Login to GHCR" step
**Solution:** Check that your `DOCKER_PASSWORD` secret contains a valid Personal Access Token with `write:packages` scope.

### Issue: Workflow succeeds but Portainer doesn't update
**Possible causes:**
- The `PORTAINER_WEBHOOK` secret might be incorrect
- Check that the webhook URL is correct in Portainer
- Manually trigger the webhook by running:
  ```bash
  curl -X POST https://your-webhook-url
  ```

### Issue: Portainer fails to pull the image
**Solution:** 
- Ensure the image name in `docker-compose.yml` matches exactly: `ghcr.io/christiankuri/gamers-wiki-backend:latest` (all lowercase)
- Make sure you made the GHCR package public (Step 3)
- If still private, you'll need to add authentication to docker-compose.yml

### Issue: Image is built for wrong architecture
**Solution:** The workflow specifies `platforms: linux/arm64`. If your server is different, update this line in `.github/workflows/main.yml`.

### Issue: Build is taking too long or timing out
**Solution:** 
- GitHub Actions has a 6-hour timeout limit per job
- For Strapi builds, this should be plenty
- If needed, you can optimize your Dockerfile to use layer caching more effectively

---

## 🎉 Success Indicators

You'll know everything is working when:

1. ✅ GitHub Actions workflow shows all green checkmarks
2. ✅ A new package appears in your GitHub Packages
3. ✅ Portainer shows the container restarted with the new image
4. ✅ Your Strapi application is accessible and working
5. ✅ Future pushes to `main` automatically deploy changes

---

## 📝 Notes

- **Build Time:** The first build might take 10-15 minutes. Subsequent builds will be faster due to layer caching.
- **Server Resources:** Your ARM64 server no longer needs to build images, saving significant CPU and memory.
- **Image Visibility:** Keep your GHCR package public, or configure authentication in docker-compose.yml for private packages.
- **Branches:** Currently configured to deploy only from `main` branch. Add more branches in the workflow file if needed.
- **Notifications:** You can add Slack/Discord notifications to the workflow for deployment status updates.

---

## 🔒 Security Best Practices

1. ✅ Never commit secrets to your repository
2. ✅ Use GitHub Secrets for all sensitive values
3. ✅ Regularly rotate your Personal Access Tokens
4. ✅ Use scoped tokens with minimal required permissions
5. ✅ Keep your Portainer webhook URL private
6. ✅ Regularly update your base images (node:22-alpine, postgres:14-alpine)

---

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Buildx Multi-platform Builds](https://docs.docker.com/build/building/multi-platform/)
- [GitHub Container Registry Guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Portainer Webhooks Documentation](https://docs.portainer.io/user/docker/stacks/webhooks)

---

**Happy Deploying! 🚀**

