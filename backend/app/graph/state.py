from typing import TypedDict
# pyrefly: ignore [missing-import]
from langgraph.graph import add_messages
# pyrefly: ignore [missing-import]
from langchain_core.messages import BaseMessage
from typing import Annotated

class State(TypedDict):
    # --- Memory ---
    messages: Annotated[list[BaseMessage], add_messages]

    # Input
    user_question: str
    db_schema: str

    # Orchestrator output
    sql_prompt: str
    chart_prompt: str
    natural_language_response: str

    # SQL Agent output
    sql_query: str
    query_results: list[dict]

    # Chart Agent output
    chart_code: str

    # Error handling
    error: str | None