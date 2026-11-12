from dotenv import load_dotenv
load_dotenv('.env')
from backend.services.intent_engine import IntentEngine
import asyncio

async def test():
    eng = IntentEngine()
    transcript = 'मैं बोल रहा हूँ कि मुकेश पटेल का bill बना दो, इसने जितना भी अभी तक ख़रीदा है सब चीज़ का total मिला के।'
    res = await eng.parse_intent(transcript)
    print(res.model_dump())

asyncio.run(test())
