"""
Migrate conversations.duckdb -> Supabase (PostgreSQL)

Usage:
    pip install duckdb psycopg2-binary pandas
    python migrations/migrate.py

Set your Supabase connection string in .env or as env var:
    SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
"""

import os
import sys
import duckdb
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv("data/.env")

DUCKDB_PATH = "data/conversations.duckdb"

def get_db_url():
    url = os.getenv("SUPABASE_DB_URL")
    if not url:
        print("ERROR: SUPABASE_DB_URL environment variable not set.")
        print()
        print("Find it in: Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI")
        print("Then run:   set SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres")
        sys.exit(1)
    return url


def load_view(con, view_name, extra_cols=None):
    df = con.execute(f"SELECT * FROM {view_name}").fetchdf()
    if extra_cols:
        for col, expr in extra_cols.items():
            df[col] = expr(df)
    return df


def insert_df(pg_conn, table, df, page_size=1000):
    cols = list(df.columns)
    col_list = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))

    rows = [tuple(None if pd.isna(v) else v for v in row) for row in df.itertuples(index=False)]

    with pg_conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO {table} ({col_list}) VALUES %s ON CONFLICT DO NOTHING",
            rows,
            page_size=page_size,
        )
    pg_conn.commit()
    print(f"  {table}: {len(rows)} rows inserted")


def main():
    db_url = get_db_url()

    print(f"Connecting to DuckDB: {DUCKDB_PATH}")
    duck = duckdb.connect(DUCKDB_PATH, read_only=True)

    print("Connecting to Supabase...")
    pg = psycopg2.connect(db_url)
    print("Connected.\n")

    # 1. conversations (csat_collected is a generated column in Postgres, skip it)
    print("Loading v_conversations...")
    df = load_view(duck, "v_conversations")
    insert_df(pg, "conversations", df)

    # 2. turns
    print("Loading v_turns...")
    df = load_view(duck, "v_turns")
    df = df.drop(columns=["id"], errors="ignore")  # let BIGSERIAL handle it
    insert_df(pg, "turns", df)

    # 3. evaluations
    print("Loading v_evaluations...")
    df = load_view(duck, "v_evaluations")
    insert_df(pg, "evaluations", df)

    # 4. data_collection
    print("Loading v_data_collection...")
    df = load_view(duck, "v_data_collection")
    insert_df(pg, "data_collection", df)

    # 5. tool_calls
    print("Loading v_tool_calls...")
    df = load_view(duck, "v_tool_calls")
    insert_df(pg, "tool_calls", df)

    duck.close()
    pg.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    main()
