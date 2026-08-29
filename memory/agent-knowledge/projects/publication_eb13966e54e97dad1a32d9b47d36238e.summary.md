---
project_execution_id: plutonix_e9599c6f-1fd9-48e4-8f2f-29d552b50cc6
project_id: voicetranscriptgenx-QcKNlU
workflow_class: executor
content_type: "project_summary"
status: succeeded
publication_id: publication_eb13966e54e97dad1a32d9b47d36238e
idempotency_key: eb13966e54e97dad1a32d9b47d36238e4900eacfbcdf7145d80297ef8a3b5f02
created_at: 2026-08-29T12:14:32.795Z
---
# Workflow Projection Summary
Only 1 .ogg file is getting converted correctly to english transcript. Rest of the files are not getting processed either or it is unable to genereate transcripts. Batch audio processing is not working on the POST request it seems. Also getting this error: { "error": "OPENAI_NON_ENGLISH_TRANSCRIPT", "message": "OpenAI returned non-English script for 2026-04-01_22-31-22_001.ogg. No mixed-language transcript was published; try the file again or choose its spoken language explicitly." } for http://localhost:5301/api/transcriptionsRequest Method POST Status Code 502 Bad Gateway Branding colours: M
Selected path: plutonix-global-orchestration
Changed files: 4
Validation: passed