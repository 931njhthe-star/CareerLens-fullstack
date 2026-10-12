import json
from app.main import app
from app.core.config import ROOT


if __name__ == '__main__':
    destination = ROOT / 'contracts/openapi/development.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(app.openapi(),ensure_ascii=False,indent=2),encoding='utf-8')
    print('Exported contracts/openapi/development.json')
