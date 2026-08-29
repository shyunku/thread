go build ./core/main.go
sudo supervisorctl restart thread
tail -f output.log