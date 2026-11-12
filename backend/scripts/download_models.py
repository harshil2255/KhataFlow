import os
import sys
import urllib.request
import zipfile

MODELS = {
    "vosk-model-small-en-in-0.4": "https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip",
    "vosk-model-small-hi-0.22": "https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip"
}

def download_models():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(base_dir, "models")
    os.makedirs(models_dir, exist_ok=True)

    print("Checking / Downloading offline Vosk models...")
    for model_name, url in MODELS.items():
        target_path = os.path.join(models_dir, model_name)
        if os.path.exists(target_path):
            print(f"✓ Model already exists: {model_name}")
            continue

        zip_path = os.path.join(models_dir, f"{model_name}.zip")
        print(f"Downloading {model_name} from {url}...")
        try:
            urllib.request.urlretrieve(url, zip_path)
            print(f"Extracting {model_name}...")
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(models_dir)
            if os.path.exists(zip_path):
                os.remove(zip_path)
            print(f"✓ Successfully set up {model_name}")
        except Exception as e:
            print(f"Failed to download {model_name}: {e}")

if __name__ == "__main__":
    download_models()
