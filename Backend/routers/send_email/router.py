"""
send_email — FastAPI route, mirrors the old `hr-dev-send_email` Cloud
Function (send_email). Sends an HTML email via Gmail SMTP with optional
base64 attachments; PDF attachments are also archived to GCS.
"""

import base64
import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import config
from gcs_client import gcs_client

router = APIRouter()

GCS_BUCKET_NAME = config.GCS_BUCKET_NAME
GCS_FOLDER = 'offer_letter'


@router.post("/api/send-email")
async def send_email(request: Request):
    try:
        request_json = await request.json()
        recipient = request_json.get('to')
        subject = request_json.get('subject')
        body = request_json.get('body')
        attachments = request_json.get('attachments', [])

        if not recipient or not subject or not body:
            return JSONResponse({'error': 'Missing required fields'}, status_code=400)

        SENDER_EMAIL = os.environ.get('SENDER_EMAIL')
        SENDER_PASSWORD = os.environ.get('SENDER_PASSWORD')

        msg = MIMEMultipart()
        msg['From'] = SENDER_EMAIL
        msg['To'] = recipient
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))

        # Process attachments cleanly
        for att in attachments:
            filename = att.get('filename', 'document.pdf')
            content = att.get('content', '')
            encoding = att.get('encoding', 'utf-8')

            # Decode the exact PDF snapshot passed from the frontend
            if encoding == 'base64':
                file_bytes = base64.b64decode(content)
                part = MIMEApplication(file_bytes, Name=filename)

                # Upload the offer letter PDF to GCS
                if filename.lower().endswith('.pdf'):
                    try:
                        bucket = gcs_client.bucket(GCS_BUCKET_NAME)
                        blob_path = f'{GCS_FOLDER}/{filename}'
                        blob = bucket.blob(blob_path)
                        blob.upload_from_string(file_bytes, content_type='application/pdf')
                        print(f"Uploaded {filename} to gs://{GCS_BUCKET_NAME}/{blob_path}")
                    except Exception as gcs_err:
                        print(f"GCS upload failed for {filename}: {gcs_err}")
            else:
                part = MIMEApplication(content.encode('utf-8'), Name=filename)

            part['Content-Disposition'] = f'attachment; filename="{filename}"'
            msg.attach(part)

        # Send the Email
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.send_message(msg)
        server.quit()

        return JSONResponse({'success': True, 'message': 'Email sent successfully'})

    except Exception as e:
        print(f"Error sending email: {e}")
        return JSONResponse({'error': str(e)}, status_code=500)