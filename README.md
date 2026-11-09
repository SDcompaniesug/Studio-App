# Studio App

Android Gradle project uploader and GitHub Actions APK builder.

## Android app source

The complete updated Android project is supplied as `StudioApp_neon_github_updates.zip` in the ChatGPT conversation. Upload that file to the repository root as `StudioApp-source.zip` to enable the `Build Studio App` workflow.

## Neon APK backend

- Neon project: `studio-build-backend`
- Project ID: `dry-fire-13288712`
- Branch: `main`
- Function: `apkapi`
- Function URL: `https://br-steep-leaf-b59uvinr-apkapi.compute.c-7.us-east-2.aws.neon.tech/`
- Private object bucket: `studio-apks`

The Android client validates the user's GitHub token through the backend, requests a short-lived presigned upload URL, uploads the APK directly to private Neon Object Storage, then requests a time-limited download URL.

## GitHub deployment

The Neon Function is already deployed. To let GitHub Actions redeploy it whenever `backend/apkapi/**` changes, add a repository Actions secret named `NEON_API_KEY` containing a Neon API key with access to this project. Do not commit the key.

Workflow: `.github/workflows/deploy-neon.yml`.

## GitHub token permissions

The token saved in Studio App needs repository access and Actions permissions to create repositories, upload source, dispatch builds, read workflow jobs/logs and artifacts. To delete a project and its remote repository, it also needs the `delete_repo` permission (or equivalent fine-grained repository administration permission).
