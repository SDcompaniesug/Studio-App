# Studio App

Android Gradle project uploader and GitHub Actions APK builder.

## Backend
The APK delivery API is deployed as a Neon Function on project `studio-build-backend`, branch `main`.
Function slug: `apkapi`.

The Android client uploads the APK to the private Neon Object Storage bucket `studio-apks` using a short-lived presigned upload URL, then requests a time-limited download URL. The API validates the caller's GitHub token against GitHub before issuing URLs.

Backend source is in `backend/apkapi/index.mjs`.
