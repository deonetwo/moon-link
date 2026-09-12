#!/usr/bin/env bash
set -e

SERVICE_NAME="moon-link"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
WORKING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(which node)"

echo "=== Setting up ${SERVICE_NAME} systemd service on AWS ==="
echo "Working directory: ${WORKING_DIR}"
echo "Node executable: ${NODE_PATH}"

if [ ! -f "${WORKING_DIR}/.env" ]; then
  echo "⚠️ Warning: .env file not found in ${WORKING_DIR}."
  echo "Please create ${WORKING_DIR}/.env before starting the service."
fi

# Build project first
echo "Building project TypeScript..."
cd "${WORKING_DIR}"
npm run build

echo "Writing ${SERVICE_FILE}..."
sudo bash -c "cat <<EOF > ${SERVICE_FILE}
[Unit]
Description=Moon-Link Discord MCP Server
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${WORKING_DIR}
EnvironmentFile=${WORKING_DIR}/.env
ExecStart=${NODE_PATH} ${WORKING_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=moon-link-mcp

[Install]
WantedBy=multi-user.target
EOF"

echo "Reloading systemd daemon..."
sudo systemctl daemon-reload
echo "Enabling ${SERVICE_NAME} to start automatically on boot..."
sudo systemctl enable "${SERVICE_NAME}"

echo ""
echo "✅ Systemd service installed successfully!"
echo "Useful commands:"
echo "  sudo systemctl start ${SERVICE_NAME}     # Start service"
echo "  sudo systemctl stop ${SERVICE_NAME}      # Stop service"
echo "  sudo systemctl restart ${SERVICE_NAME}   # Restart service"
echo "  sudo systemctl status ${SERVICE_NAME}    # Check service status"
echo "  journalctl -u ${SERVICE_NAME} -f        # View live logs"
