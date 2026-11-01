"""Speech-to-text worker, run with DataDojo's private whisper environment (see interview.py).

  python whisper_worker.py --download MODEL DIR   fetch the model into DIR and exit
  python whisper_worker.py --serve MODEL DIR      read {"path": ...} lines on stdin, write {"text", "seconds"} lines
"""
import json, sys


def main():
    mode, name, root = sys.argv[1:4]
    from faster_whisper import WhisperModel
    model = WhisperModel(name, device="cpu", compute_type="int8", download_root=root)
    if mode == "--download":
        return
    for line in sys.stdin:
        try:
            segments, info = model.transcribe(json.loads(line)["path"], beam_size=1, vad_filter=True,
                                              language="en" if name.endswith(".en") else None)
            out = {"text": " ".join(s.text.strip() for s in segments).strip(), "seconds": round(info.duration, 1)}
        except Exception as e:  # a bad recording shouldn't kill the worker
            out = {"error": f"Couldn't transcribe that recording ({type(e).__name__})."}
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
