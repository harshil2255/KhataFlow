from pydantic import BaseModel, Field
from typing import Optional, List

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

class LineItem(BaseModel):
    name: str = Field(description="Name of the item, e.g., Maida, Maggi, Chawal")
    qty: float = Field(default=1.0, description="Quantity, defaults to 1.0 if not specified")
    unit: Optional[str] = Field(default="pkt", description="Unit like pkt, kg, ltr, piece")
    unit_price: float = Field(default=0.0, description="Price per unit or total price if qty=1")
    total: float = Field(default=0.0, description="qty * unit_price")

class ActionItem(BaseModel):
    action: str = Field(description="ADD_CREDIT, RECORD_PAYMENT, QUERY_BALANCE, CORRECTION, REASSIGN_ENTRY, DISAMBIGUATION_RESPONSE, NEEDS_CLARIFICATION, or UNKNOWN")
    customer: Optional[str] = Field(default=None, description="Customer name, e.g., Ramesh, Suresh, Krishna Nema")
    from_customer: Optional[str] = Field(default=None, description="Original/previous customer name when reassigning or transferring an entry")
    phone: Optional[str] = Field(default=None, description="Customer phone if mentioned")
    amount: Optional[float] = Field(default=None, description="Total amount in rupees")
    date: Optional[str] = Field(default="today", description="today, yesterday, specific date")
    notes: Optional[str] = Field(default="", description="Items or context, e.g., 200 Maida + 50 Maggi")
    target: Optional[str] = Field(default="total", description="total, today, last_week for query")
    target_item: Optional[str] = Field(default=None, description="Specific item name being corrected or updated, e.g., Ande")
    items: List[LineItem] = Field(default_factory=list, description="Itemized bill items")

class IntentResponse(BaseModel):
    status: str = Field(default="OK", description="OK, NEEDS_CLARIFICATION, ERROR")
    actions: List[ActionItem] = []
    confidence: float = 1.0
    spoken_reply: Optional[str] = Field(default=None, description="Warm natural conversational spoken reply in Hinglish/Hindi")
    missing_fields: List[str] = Field(default_factory=list, description="Fields needed e.g. customer, amount, price")
