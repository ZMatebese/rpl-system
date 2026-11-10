#!/usr/bin/env bash
# End-to-end lifecycle smoke test against a running API.
set -euo pipefail
API=${API:-http://localhost:4000}
j() { jq -r "$1"; }

echo "== 1. Applicant logs in"
APP_TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"applicant@rpl.local","password":"Applicant#2026"}' | j '.token')
echo "   token acquired"

echo "== 2. Applicant creates a draft application"
APP_ID=$(curl -s -X POST $API/api/applications -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"qualificationId":3,"motivation":"15 years of systems administration experience across identity management and directory services."}' \
  | j '.application.id')
echo "   application #$APP_ID created in DRAFT"

echo "== 3. Submit WITHOUT evidence (guard must refuse with 422)"
CODE=$(curl -s -o /tmp/guard.json -w '%{http_code}' -X POST $API/api/applications/$APP_ID/submit \
  -H "Authorization: Bearer $APP_TOKEN")
echo "   HTTP $CODE  $(cat /tmp/guard.json)"
[ "$CODE" = "422" ] || { echo "FAIL: guard did not refuse"; exit 1; }

echo "== 4. Attach evidence"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>' > /tmp/cv.pdf
curl -s -X POST $API/api/applications/$APP_ID/evidence -H "Authorization: Bearer $APP_TOKEN" \
  -F "file=@/tmp/cv.pdf;type=application/pdf" -F "evidenceType=CV" -F "description=Curriculum vitae" \
  | j '.evidence.stored_filename' | sed 's/^/   stored as /'

echo "== 5. Reject a disallowed file type (expect 415)"
echo "#!/bin/sh" > /tmp/bad.sh
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/applications/$APP_ID/evidence \
  -H "Authorization: Bearer $APP_TOKEN" -F "file=@/tmp/bad.sh;type=application/x-sh")
echo "   HTTP $CODE"
[ "$CODE" = "415" ] || { echo "FAIL: disallowed type accepted"; exit 1; }

echo "== 6. Submit again (guard now satisfied)"
curl -s -X POST $API/api/applications/$APP_ID/submit -H "Authorization: Bearer $APP_TOKEN" \
  | j '.application.status' | sed 's/^/   status now /'

echo "== 7. Applicant attempts an ADMIN endpoint (expect 403)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' $API/api/applications/queue -H "Authorization: Bearer $APP_TOKEN")
echo "   HTTP $CODE"
[ "$CODE" = "403" ] || { echo "FAIL: cross-role access allowed"; exit 1; }

echo "== 8. Administrator logs in and allocates an assessor"
ADM_TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@rpl.local","password":"Admin#2026"}' | j '.token')
# Pin the allocation by email so the negative test below uses a genuinely
# different assessor regardless of list ordering.
ASSESSOR_ID=$(curl -s $API/api/admin/assessors -H "Authorization: Bearer $ADM_TOKEN" \
  | j '.assessors[] | select(.email=="assessor@rpl.local") | .id')
curl -s -X POST $API/api/applications/$APP_ID/allocate -H "Authorization: Bearer $ADM_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"assessorId\":$ASSESSOR_ID}" \
  | j '.application.status' | sed 's/^/   status now /'

echo "== 9. Wrong assessor attempts the assessment (expect 403)"
WRONG_TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"assessor2@rpl.local","password":"Assessor#2026"}' | j '.token')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/applications/$APP_ID/assessment \
  -H "Authorization: Bearer $WRONG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"criterionRatings":{"currency":"MET","authenticity":"MET","sufficiency":"MET","relevance":"MET","level":"MET"},"comments":"x","recommendation":"RECOMMEND_APPROVE"}')
echo "   HTTP $CODE"
[ "$CODE" = "403" ] || { echo "FAIL: unallocated assessor permitted"; exit 1; }

echo "== 10. Allocated assessor records the assessment"
ASR_TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"assessor@rpl.local","password":"Assessor#2026"}' | j '.token')
curl -s -X POST $API/api/applications/$APP_ID/assessment -H "Authorization: Bearer $ASR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"criterionRatings":{"currency":"MET","authenticity":"MET","sufficiency":"PARTIALLY_MET","relevance":"MET","level":"MET"},"comments":"Substantial relevant experience evidenced. Sufficiency marginal on the project management outcome.","recommendation":"RECOMMEND_APPROVE"}' \
  | j '.application.status' | sed 's/^/   status now /'

echo "== 11. Administrator ratifies the outcome"
curl -s -X POST $API/api/applications/$APP_ID/outcome -H "Authorization: Bearer $ADM_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve","rationale":"Assessment supports the claim. Credit granted for two modules."}' \
  | j '.application.status' | sed 's/^/   status now /'

echo "== 12. Audit trail"
curl -s $API/api/applications/$APP_ID/audit -H "Authorization: Bearer $ADM_TOKEN" | python3 -c "
import sys,json
for h in json.load(sys.stdin)['history']:
    print(f\"   {h['changed_at']}  {str(h['previous_status']):>20} -> {h['new_status']:<20} by {h['actor_first_name']} {h['actor_surname']} ({h['actor_role']})\")
"

echo "== 13. Terminal state is terminal (expect 409)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/applications/$APP_ID/outcome \
  -H "Authorization: Bearer $ADM_TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"reject","rationale":"changed my mind"}')
echo "   HTTP $CODE"
[ "$CODE" = "409" ] || { echo "FAIL: terminal state mutated"; exit 1; }

echo
echo "ALL LIFECYCLE CHECKS PASSED"
