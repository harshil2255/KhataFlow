from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class CustomerModel(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    total_balance: float = 0.0
    created_at: str

class TransactionModel(BaseModel):
    id: int
    customer_id: int
    amount: float
    type: str  # CREDIT, PAYMENT, CORRECTION
    notes: Optional[str] = None
    created_at: str
    is_deleted: int = 0
    deleted_at: Optional[str] = None
    idempotency_key: Optional[str] = None

class ActionItem(BaseModel):
    action: str = Field(description="ADD_CREDIT, RECORD_PAYMENT, QUERY_BALANCE, CORRECTION, DISAMBIGUATION_RESPONSE, or UNKNOWN")
    customer: Optional[str] = Field(default=None, description="Customer name, e.g., Ramesh")
    phone: Optional[str] = Field(default=None, description="Customer phone if mentioned")
    amount: Optional[float] = Field(default=None, description="Amount in rupees")
    date: Optional[str] = Field(default="today", description="today, yesterday, specific date")
    notes: Optional[str] = Field(default="", description="Items or context, e.g. dal, cheeni")
    target: Optional[str] = Field(default="total", description="total, today, last_week for query")

class IntentResponse(BaseModel):
    actions: List[ActionItem] = []
    confidence: float = 1.0
    spoken_summary: Optional[str] = None
