# Stack Management

Stacks let you add runtime environments, databases, tools, and frameworks to your projects. Instead of manually configuring each service, pick from available stacks and Aionima handles the rest.

## What is a Stack?

A stack is a pre-configured bundle that provides something your project needs:

- **Runtime** stacks set the programming language version (Node.js 24, PHP 8.5, etc.)
- **Database** stacks add a shared database (PostgreSQL, MariaDB) with per-project credentials
- **Tooling** stacks add development tools
- **Framework** stacks configure framework-specific settings
- **Workflow** stacks add automated processes

## Adding a Stack

1. Open your project in the Development tab
2. Enable hosting if not already enabled
3. Find the **Stacks** section below the hosting configuration
4. Click **Add Stack**
5. Browse available stacks grouped by category
6. Click **Add** on the stack you want

## Database Stacks

Database stacks are special — they share a single container across all your projects. When you add PostgreSQL 17 to three projects, only one PostgreSQL container runs. Each project gets its own database, username, and password.

After adding a database stack, you'll see:
- A connection URL with a **Copy** button
- Your per-project database credentials

## Stack Cards

Each installed stack shows:
- Category badge (runtime, database, etc.)
- Requirements it provides
- Connection URL (for database stacks)
- Expandable guides with usage instructions
- A **Remove** button (with confirmation)

## Container Terminal

When a project container is running, you can open a terminal directly inside it:

1. Scroll to the bottom of the hosting panel
2. Switch from the **Logs** tab to the **Terminal** tab
3. You get a shell inside the container for debugging

## Removing a Stack

Click **Remove** on any stack card. For database stacks, this drops the project's database and user from the shared container. If no more projects use that database version, the shared container stops automatically.
