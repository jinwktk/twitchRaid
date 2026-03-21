def get_sent_message_id(send_result):
    """send_chat_message の結果から message_id を取り出す。"""
    if send_result is None:
        raise ValueError("send result is None")

    if not getattr(send_result, "is_sent", False):
        drop_reason = getattr(send_result, "drop_reason", None)
        reason_message = getattr(drop_reason, "message", None) if drop_reason else None
        reason = reason_message or "message was not sent"
        raise ValueError(reason)

    message_id = getattr(send_result, "message_id", "")
    if not message_id:
        raise ValueError("message id is empty")

    return message_id
