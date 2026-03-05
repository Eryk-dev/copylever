"""
Email service — sends password reset emails via SMTP.
"""
import logging
import smtplib
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def send_reset_email(to_email: str, reset_token: str) -> None:
    """Send a password reset email. Silently skips if SMTP is not configured."""
    if not settings.smtp_host:
        logger.warning("Email not configured, skipping reset email")
        return

    link = f"{settings.base_url}?reset_token={reset_token}"

    body = (
        "Voce solicitou a redefinicao de senha.\n"
        "\n"
        f"Clique no link abaixo:\n{link}\n"
        "\n"
        "Este link expira em 1 hora.\n"
        "\n"
        "Se voce nao solicitou, ignore este email."
    )

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = "Copy Anuncios — Redefinir senha"
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        logger.info("Reset email sent to %s", to_email)
    except Exception:
        logger.exception("Failed to send reset email to %s", to_email)
        raise
