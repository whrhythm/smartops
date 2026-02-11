#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_URL=${KEYCLOAK_URL:-"https://172.27.119.71:8443"}
KEYCLOAK_ADMIN_USER=${KEYCLOAK_ADMIN_USER:-"admin"}
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD:-"admin"}
KEYCLOAK_CA_CERT=${KEYCLOAK_CA_CERT:-"/home/edge/keycloak/keycloak-certs/keycloak_ca.crt"}

REALM_NAME=${REALM_NAME:-"cloud"}
CLIENT_ID=${CLIENT_ID:-"cloud_id"}
REDIRECT_URI=${REDIRECT_URI:-"http://172.27.119.71:7007/api/auth/oidc/handler/frame"}
USER_NAME=${USER_NAME:-"backstage-user"}
USER_PASSWORD=${USER_PASSWORD:-"ChangeMe123!"}

curl_args=("--silent" "--show-error" "--fail")
if [[ -f "${KEYCLOAK_CA_CERT}" ]]; then
  curl_args+=("--cacert" "${KEYCLOAK_CA_CERT}")
else
  echo "CA cert not found at ${KEYCLOAK_CA_CERT}, continuing without --cacert" >&2
fi

get_token() {
  curl "${curl_args[@]}" \
    -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=admin-cli" \
    -d "username=${KEYCLOAK_ADMIN_USER}" \
    -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
    -d "grant_type=password" | \
    python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}

TOKEN=$(get_token)
AUTH_HEADER=("-H" "Authorization: Bearer ${TOKEN}")

create_realm() {
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    -X POST "${KEYCLOAK_URL}/admin/realms" \
    -H "Content-Type: application/json" \
    -d "{\"realm\":\"${REALM_NAME}\",\"enabled\":true}" \
    || echo "Realm '${REALM_NAME}' already exists or could not be created" >&2
}

create_client() {
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    -X POST "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/clients" \
    -H "Content-Type: application/json" \
    -d "{\"clientId\":\"${CLIENT_ID}\",\"protocol\":\"openid-connect\",\"publicClient\":false,\"standardFlowEnabled\":true,\"directAccessGrantsEnabled\":true,\"redirectUris\":[\"${REDIRECT_URI}\"],\"webOrigins\":[\"+\"]}" \
    || echo "Client '${CLIENT_ID}' already exists or could not be created" >&2
}

get_client_uuid() {
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/clients?clientId=${CLIENT_ID}" | \
    python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["id"] if data else "")'
}

get_client_secret() {
  local client_uuid="$1"
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/clients/${client_uuid}/client-secret" | \
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("value", ""))'
}

create_user() {
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    -X POST "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${USER_NAME}\",\"enabled\":true}" \
    || echo "User '${USER_NAME}' already exists or could not be created" >&2
}

get_user_uuid() {
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users?username=${USER_NAME}" | \
    python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["id"] if data else "")'
}

set_user_password() {
  local user_uuid="$1"
  curl "${curl_args[@]}" "${AUTH_HEADER[@]}" \
    -X PUT "${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users/${user_uuid}/reset-password" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"password\",\"value\":\"${USER_PASSWORD}\",\"temporary\":false}"
}

create_realm
create_client

CLIENT_UUID=$(get_client_uuid)
if [[ -z "${CLIENT_UUID}" ]]; then
  echo "Unable to resolve client UUID for '${CLIENT_ID}'" >&2
  exit 1
fi

CLIENT_SECRET=$(get_client_secret "${CLIENT_UUID}")

create_user
USER_UUID=$(get_user_uuid)
if [[ -z "${USER_UUID}" ]]; then
  echo "Unable to resolve user UUID for '${USER_NAME}'" >&2
  exit 1
fi

set_user_password "${USER_UUID}"

echo "Realm: ${REALM_NAME}"
echo "Client ID: ${CLIENT_ID}"
echo "Client Secret: ${CLIENT_SECRET}"
echo "User: ${USER_NAME}"
