from __future__ import annotations

from json import dumps
from logging import Formatter, LogRecord, basicConfig, getLogger
from os import getenv
from typing import Any


class JsonFormatter(Formatter):
    def format(self, record: LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "event_data"):
            payload.update(record.event_data)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    basicConfig(level=getenv("LOG_LEVEL", "INFO"), format="%(message)s", force=False)
    for handler in getLogger().handlers:
        handler.setFormatter(JsonFormatter())


def log_event(event: str, **fields: Any) -> None:
    getLogger("taobao_category_analysis").info(event, extra={"event_data": {"event": event, **fields}})
