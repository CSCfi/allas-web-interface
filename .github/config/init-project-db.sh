#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER sharing;
    CREATE DATABASE swiftbrowserdb;
    GRANT ALL PRIVILEGES ON DATABASE swiftbrowserdb TO sharing;
    ALTER USER sharing WITH PASSWORD '$SHARING_PASSWORD';
EOSQL

psql -v ON_ERROR_STOP=1 --username "sharing" --dbname "swiftbrowserdb" <<-EOSQL
    CREATE TABLE IF NOT EXISTS Shares(
        container TEXT,
        container_owner TEXT,
        recipient TEXT,
        r_read BOOL,
        r_write BOOL,
        sharingdate TIMESTAMP,
        address TEXT           NOT NULL,
        PRIMARY KEY(container, container_owner, recipient)
    );
    CREATE TABLE IF NOT EXISTS ProjectIDs(
        name TEXT,
        id TEXT,
        PRIMARY KEY(id)
    );
    CREATE TABLE IF NOT EXISTS Requests(
        container TEXT,
        container_owner TEXT,
        recipient TEXT,
        created TIMESTAMP,
        PRIMARY KEY(container, container_owner, recipient)
    );
    CREATE TABLE IF NOT EXISTS Tokens(
        token_owner TEXT,
        token_owner_name TEXT,
        token TEXT,
        identifier TEXT,
        created TIMESTAMP,
        PRIMARY KEY(token_owner, identifier)
    );
EOSQL
