"""
WebSocket Connection Manager.

Maintains two buckets of active connections:
  - students: keyed by session_id
  - admins:   keyed by admin_id

broadcast_to_admins() fans out a message dict to every connected admin.
"""
import asyncio
from typing import Dict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # Maps user/session id -> WebSocket for quick disconnect lookups
        self.students: Dict[str, WebSocket] = {}
        self.admins: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, role: str, user_id: str) -> None:
        """Accept the WebSocket handshake and register the connection."""
        await websocket.accept()
        if role == "student":
            self.students[user_id] = websocket
        elif role == "admin":
            self.admins[user_id] = websocket

    def disconnect(self, role: str, user_id: str) -> None:
        """Remove a connection from the active pool."""
        if role == "student":
            self.students.pop(user_id, None)
        elif role == "admin":
            self.admins.pop(user_id, None)

    async def broadcast_to_admins(self, message: dict) -> None:
        """
        Fan out *message* as JSON to every currently connected admin.
        Runs all sends concurrently via asyncio.gather so a slow admin
        client doesn't stall the others.
        """
        if not self.admins:
            return
        tasks = [ws.send_json(message) for ws in self.admins.values()]
        await asyncio.gather(*tasks, return_exceptions=True)


# Singleton shared across the application
manager = ConnectionManager()
