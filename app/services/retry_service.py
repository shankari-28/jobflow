import random
from datetime import datetime, timedelta


def compute_next_retry_at(
    strategy: str,
    base_delay_ms: int,
    max_delay_ms: int,
    jitter_ms: int,
    attempt: int,
) -> datetime:
    """
    Compute when a failed job should be retried.

    Args:
        strategy: one of fixed | linear | exponential | exponential_jitter
        base_delay_ms: base delay in milliseconds
        max_delay_ms: cap on computed delay
        jitter_ms: max random jitter added (only for exponential_jitter)
        attempt: current retry attempt number (1-indexed)
    """
    if strategy == "fixed":
        delay_ms = base_delay_ms

    elif strategy == "linear":
        delay_ms = base_delay_ms * attempt

    elif strategy == "exponential":
        delay_ms = base_delay_ms * (2 ** (attempt - 1))

    elif strategy == "exponential_jitter":
        delay_ms = base_delay_ms * (2 ** (attempt - 1))
        delay_ms += random.randint(0, max(0, jitter_ms))

    else:
        # Unknown strategy — fall back to exponential
        delay_ms = base_delay_ms * (2 ** (attempt - 1))

    # Apply cap
    delay_ms = min(delay_ms, max_delay_ms)
    return datetime.utcnow() + timedelta(milliseconds=delay_ms)


def should_retry(retry_count: int, max_retries: int) -> bool:
    return retry_count < max_retries
