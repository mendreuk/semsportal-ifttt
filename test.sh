#!/bin/bash

set -x

curl -X POST "https://semsportal-ifttt-api-prod-331310863393.europe-west4.run.app/ifttt/v1/queries/metric" \
-H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjRPMGZCb3BWcGViTmFPcUIzZXBYaSJ9.eyJodHRwczovL2lmdHR0LmNvbS9zZW1zcG9ydGFsL3VzZXIiOnsiYXV0aCI6eyJhY2Nlc3NfdG9rZW4iOiJleUoxYVdRaU9pSTFaalkyWWpObFpTMDJaREJpTFRRMll6UXRZbVpqWlMxaFlqZzJaV05sTUdNMVltTWlMQ0owYVcxbGMzUmhiWEFpT2pFM056RXpOVEk0TmpBeE9ESXNJblJ2YTJWdUlqb2lNRGxsWkRWa056SmpOR05oTlRGbVpqQXdPR1poWXpkbFpEQXlNVEEzTmpNaUxDSmpiR2xsYm5RaU9pSnBiM01pTENKMlpYSnphVzl1SWpvaWRqTXVNU0lzSW14aGJtZDFZV2RsSWpvaVpXNGlmUT09In0sImVtYWlsIjoicGV0ci5yZWhhcUBnbWFpbC5jb20iLCJwbGFuIjp7ImNoZWNrX3BlcmlvZF9zZWMiOjYwLCJjcmVhdGVkX2F0IjoxNzM4OTY3NDQxNTU3LCJleHBpcmVzX2F0IjoxOTk5OTk5OTk5OTk5fX0sImlzcyI6Imh0dHBzOi8vZGV2LTE1aHI4d3ZhaGYyem03ajAuZXUuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDVmNjZiM2VlLTZkMGItNDZjNC1iZmNlLWFiODZlY2UwYzViYyIsImF1ZCI6WyJzZW1zcG9ydGFsLWlmdHR0IiwiaHR0cHM6Ly9kZXYtMTVocjh3dmFoZjJ6bTdqMC5ldS5hdXRoMC5jb20vdXNlcmluZm8iXSwiaWF0IjoxNzcxMzUyODYwLCJleHAiOjE3NzE0MzkyNjAsInNjb3BlIjoib3BlbmlkIHByb2ZpbGUgZW1haWwgb2ZmbGluZV9hY2Nlc3MiLCJhenAiOiJwWkZ5bkp4ZTFQYTdnVmdYeFNnbzN0eHJiQWh0OWw3ViJ9.eR0RiWQY2h-RHFPqzRykkaYis1qpHofCQ8v4ZUiH1Mah90sYYaBHLHNVdLnXPbjrT9II8MPvNrqlxgw2CTVbtmJXzBx_2ornkp8Z_GTa9M6Y8VvubHV1ojZ001wVAa4w12oiZv8PeNOSP_3yzyDaSRp4dZLJXGeS-VQ5if7YqCexT8RpWsGLdk1JmGITf6IN-TjYAYDWAGI9dHhv90YwfXoP7I5tJlv_y1AZjwcvCIql5etsyR_YJf2cA2r3IVkrfMNjA_bKRXStx-ZpTMTRXWSrk8_lLdDSBXt1DdRHF_55-Qs1NA5HlwY5soNDaUet0U1NyEfGZwpqblGq6SWXdQ" \
-H "Content-Type: application/json" \
-d '{
  "queryFields": {
    "inverter_metric_id": "d2b9fcca-64da-405b-81ba-83abbced643a|+0100|92500SSN194W0086&18|Pac",
    "when": "now"
  },
  "user": {
    "timezone": "America/Los_Angeles"
  },
  "ifttt_source": {
    "id": "d55f4d9125c1dfc2",
    "url": "http://example.com/d55f4d9125c1dfc2"
  },
  "cursor":"0|50"
}'

