mkdir -p certificates
sudo cp /etc/letsencrypt/live/memorial.im/fullchain.pem certificates/cert.pem
sudo cp /etc/letsencrypt/live/memorial.im/privkey.pem certificates/key.pem
sudo chmod 664 certificates/cert.pem
sudo chmod 664 certificates/key.pem