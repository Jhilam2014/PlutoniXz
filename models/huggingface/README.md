# PlutoniX Hugging Face Models

This is the PlutoniX-local Hugging Face model workspace.

Use this folder whenever PlutoniX itself requires a Hugging Face model for self-improvement, small local tasks, or generated-project support:

```bash
npm run hf:models:add -- namespace/model task-name
npm run hf:models:download -- namespace/model
npm run hf:models:build
npm run hf:models:status
```

Downloaded repositories live under `models/huggingface/repositories/`. Local service metadata is generated under `models/huggingface/services/`.

`hf:models:download` downloads the complete Hugging Face repository by default, including all model weight files and shards. `HF_MODEL_INCLUDE` and `HF_MODEL_EXCLUDE` are ignored unless `HF_MODEL_PARTIAL_DOWNLOAD=1` is explicitly set for a temporary diagnostic run.

When a model is added or downloaded, PlutoniX estimates the Hugging Face repository size and records it as `sizeGb`/`sizeLabel` in the manifest and service metadata.

The scripts use the modern `hf` CLI. Install it with:

```bash
curl -LsSf https://hf.co/cli/install.sh | bash -s
```

Keep Hugging Face tokens in `HF_TOKEN`; never write tokens into this repository.
