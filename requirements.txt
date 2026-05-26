# Project Requirements

This is a Node.js web application built with a React frontend and an Express/Mongoose backend.
Instead of pip installing from this file, standard setup involves running `npm install` inside both the `backend` and `frontend` directories.

## Backend Dependencies (from backend/package.json)
- bcryptjs >= 2.4.3
- cors >= 2.8.5
- dotenv >= 16.3.1
- express >= 4.18.2
- express-mongo-sanitize >= 2.2.0
- express-rate-limit >= 7.5.1
- helmet >= 8.0.0
- google-auth-library >= 8.9.0
- jsonwebtoken >= 9.0.2
- mongoose >= 7.6.0
- nodemailer >= 6.9.15
- socket.io >= 4.7.2
- nodemon >= 3.0.1 (Dev Dependency)

## Frontend Dependencies (from frontend/package.json)
- axios >= 1.6.0
- crypto-js >= 4.2.0
- emoji-picker-react >= 4.19.1
- react >= 18.2.0
- react-dom >= 18.2.0
- react-router-dom >= 6.20.0
- react-scripts == 5.0.1
- socket.io-client >= 4.7.2

## System Requirements
- Node.js (v14 or higher recommended)
- npm (Node Package Manager)
- MongoDB Database (either local or MongoDB Atlas)
- SMTP account for OTP / password reset email delivery in production
- Google OAuth client ID configured in Google Cloud Console

## Deployment Requirements
- Backend environment variables must be set on the deployed server (Render, AWS, etc.)
- Frontend environment variables must be set on the frontend service if it is deployed separately
- Google OAuth authorized JavaScript origins must include the exact frontend URL used by the browser
