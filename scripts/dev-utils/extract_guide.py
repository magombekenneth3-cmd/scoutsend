import json
import os

transcript_path = "/Users/extremesales/.gemini/antigravity-ide/brain/90171e15-86d3-4e91-a082-c3970324c552/.system_generated/logs/transcript.jsonl"
output_path = "/Users/extremesales/aisales/web/queue_guide.md"

if not os.path.exists(transcript_path):
    print("Transcript file does not exist")
else:
    with open(transcript_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line)
                if data.get("step_index") == 1288:
                    content = data.get("content", "")
                    with open(output_path, "w", encoding="utf-8") as out:
                        out.write(content)
                    print(f"Guide extracted successfully to {output_path}")
                    break
            except Exception as e:
                pass
