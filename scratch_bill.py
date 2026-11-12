from dotenv import load_dotenv
load_dotenv('.env')
from backend.services.intent_engine import IntentEngine
import asyncio

async def test():
    eng = IntentEngine()
    prompt = """Extract itemized bill items from customer purchase history notes:
Notes:
- 'Mukesh Patel ne 10 packet Maggi (10rs each), 10 packet Maida (100rs total), aur 5 packet Patakhe (160rs total) khareede.'
- 'Mukesh Patel ne khareeda (100rs)'

Strict JSON Output format:
{
  "items": [
    {"name": "Maggi", "qty": 10.0, "unit": "pkt", "unit_price": 10.0, "total": 100.0},
    {"name": "Maida", "qty": 10.0, "unit": "pkt", "unit_price": 10.0, "total": 100.0},
    {"name": "Patakhe", "qty": 5.0, "unit": "pkt", "unit_price": 32.0, "total": 160.0},
    {"name": "General Items", "qty": 1.0, "unit": "lot", "unit_price": 100.0, "total": 100.0}
  ]
}"""
    comp = await eng.client.chat.completions.create(
        model='qwen/qwen3.8-27b',
        messages=[{'role': 'user', 'content': prompt}],
        response_format={'type': 'json_object'}
    )
    print(comp.choices[0].message.content)

asyncio.run(test())
