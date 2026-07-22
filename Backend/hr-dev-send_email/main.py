import os
import json
import smtplib
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
import functions_framework

@functions_framework.http
def send_email(request):
    # 1. Handle CORS
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    if request.method != 'POST':
        return ({'error': 'Method not allowed'}, 405, headers)

    try:
        request_json = request.get_json(silent=True)
        recipient = request_json.get('to')
        subject = request_json.get('subject')
        body = request_json.get('body')
        attachments = request_json.get('attachments', [])

        if not recipient or not subject or not body:
            return ({'error': 'Missing required fields'}, 400, headers)

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

        return ({'success': True, 'message': 'Email sent successfully'}, 200, headers)

    except Exception as e:
        print(f"Error sending email: {e}")
        return ({'error': str(e)}, 500, headers)