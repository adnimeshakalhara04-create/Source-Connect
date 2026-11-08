"""Tiny S3 helper for the local drill: create bucket, corrupt one backup file, peek at stored bytes."""
import argparse, boto3, sys
ap = argparse.ArgumentParser()
ap.add_argument('--endpoint'); ap.add_argument('--ca')
ap.add_argument('cmd'); ap.add_argument('bucket'); ap.add_argument('prefix', nargs='?', default='')
a = ap.parse_args()
s3 = boto3.client('s3', endpoint_url=a.endpoint, verify=a.ca, region_name='us-east-1', aws_access_key_id='S3RVER', aws_secret_access_key='S3RVER')
if a.cmd == 'mkbucket':
    s3.create_bucket(Bucket=a.bucket); print('bucket created:', a.bucket)
elif a.cmd in ('corrupt', 'peek'):
    allobjs = []
    for page in s3.get_paginator('list_objects').paginate(Bucket=a.bucket, Prefix=a.prefix):
        allobjs += page.get('Contents', [])
    objs = [o for o in allobjs if o['Size'] > 200 and not o['Key'].endswith(('.info', '.copy', '.manifest', '.manifest.copy'))]
    if not objs: print('no objects under', a.prefix); sys.exit(1)
    key = sorted(objs, key=lambda o: -o['Size'])[0]['Key']
    body = s3.get_object(Bucket=a.bucket, Key=key)['Body'].read()
    if a.cmd == 'corrupt':
        bad = bytearray(body); mid = len(bad) // 2
        for i in range(mid, min(mid + 64, len(bad))): bad[i] ^= 0xFF
        s3.put_object(Bucket=a.bucket, Key=key, Body=bytes(bad))
        print(f'corrupted 64 bytes in the middle of {key} ({len(body)} bytes)')
    else:
        printable = sum(32 <= b < 127 for b in body[:4096]) / max(1, min(len(body), 4096))
        print(f'stored object {key}: {len(body)} bytes, first bytes {body[:16].hex()} — {printable:.0%} printable (encrypted data looks random)')
