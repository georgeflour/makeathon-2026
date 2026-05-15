"""
MCP server exposing DuckDB query tools for NR2Dashboard.
Run standalone with: python -m app.mcp_server
"""
from pathlib import Path
from fastmcp import FastMCP
from app.query_engine import execute_query

mcp = FastMCP("NR2Dashboard")

_data_dir = Path(__file__).parent / "data"


@mcp.tool()
def run_query(sql: str) -> list[dict]:
    """Execute a SQL SELECT query against the conversations DuckDB database."""
    return execute_query(sql)


@mcp.tool()
def get_schema() -> str:
    """Return the full database schema including all views and column definitions."""
    return (_data_dir / "schema.md").read_text(encoding="utf-8")


@mcp.tool()
def get_metrics() -> str:
    """Return canonical metric definitions (containment rate, CSAT, AHT, etc.)."""
    return (_data_dir / "metrics_dictionary.md").read_text(encoding="utf-8")


if __name__ == "__main__":
    mcp.run()
