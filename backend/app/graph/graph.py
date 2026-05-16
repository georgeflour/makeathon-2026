# pyrefly: ignore [missing-import]
from langgraph.graph import END, START, StateGraph
# pyrefly: ignore [missing-import]
from langgraph.checkpoint.sqlite import SqliteSaver

from state import State
from nodes import orchestrate, generate_sql, execute_sql, generate_chart


# ---------------------------------------------------------------------------
# Conditional routing after execute_sql
# ---------------------------------------------------------------------------

def _route_after_execute_sql(state: State) -> str:
    """Go to END on error, otherwise continue to generate_chart."""
    if state.get("error") is not None:
        return END
    return "generate_chart"


# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------

builder = StateGraph(State)

# Register nodes
builder.add_node("orchestrate", orchestrate)
builder.add_node("generate_sql", generate_sql)
builder.add_node("execute_sql", execute_sql)
builder.add_node("generate_chart", generate_chart)

# Linear edges
builder.add_edge(START, "orchestrate")
builder.add_edge("orchestrate", "generate_sql")
builder.add_edge("generate_sql", "execute_sql")

# Conditional edge: error → END, success → generate_chart
builder.add_conditional_edges(
    "execute_sql",
    _route_after_execute_sql,
    {END: END, "generate_chart": "generate_chart"},
)

builder.add_edge("generate_chart", END)

# ---------------------------------------------------------------------------
# Compile with SqliteSaver checkpointer
# ---------------------------------------------------------------------------

checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
graph = builder.compile(checkpointer=checkpointer)
