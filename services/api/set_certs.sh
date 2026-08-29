mkdir -p certificates
sudo cp /etc/letsencrypt/live/threadapp.kr/fullchain.pem certificates/cert.pem
sudo cp /etc/letsencrypt/live/threadapp.kr/privkey.pem certificates/key.pem
sudo chmod 664 certificates/cert.pem
sudo chmod 664 certificates/key.pem