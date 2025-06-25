# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a LINE webhook bot that integrates with Obsidian to automatically create diary entries from LINE messages. The bot receives messages via LINE webhook, processes them, and commits them to a Git repository containing an Obsidian vault.

## Architecture

- **Serverless Framework**: AWS Lambda functions with HTTP API Gateway
- **LINE Bot SDK**: Handles webhook verification and message processing  
- **Git Integration**: Uses `simple-git` to clone, commit, and push to Obsidian vault repository
- **File Structure**: Creates/appends to daily markdown files in `diary/YYYY-MM-DD.md` format

## Key Components

- `handler.js`: Main Lambda function that processes LINE webhooks
- `serverless.yml`: Infrastructure configuration with environment variables and deployment settings
- Environment variables managed through `.env` file and stage parameters

## Development Commands

### Local Development
```bash
serverless dev
```
Starts local emulator with hot reloading for development.

### Deployment
```bash
serverless deploy
serverless deploy --stage prod
```
Deploy to AWS Lambda. Defaults to `dev` stage.

### Environment Setup
Required environment variables in `.env`:
- `GH_TOKEN`: GitHub personal access token for repository access
- `CHANNEL_SECRET`: LINE Bot channel secret for webhook verification
- `GIT_REPO`: Target Obsidian vault repository URL

## Message Processing Flow

1. Webhook signature verification using LINE channel secret
2. Extract timestamp and text from LINE message
3. Clone Obsidian vault repository to `/tmp/vault`
4. Create or append to daily diary file in `diary/` directory
5. Commit and push changes with timestamp-based commit message

## Dependencies

- `@line/bot-sdk`: LINE Bot SDK for webhook handling
- `simple-git`: Git operations in Node.js
- `dayjs`: Date/time manipulation with timezone support
- `serverless-dotenv-plugin`: Environment variable management

## Documentation Reference

For Serverless Framework usage and configuration, refer to the official documentation:
https://www.serverless.com/framework/docs