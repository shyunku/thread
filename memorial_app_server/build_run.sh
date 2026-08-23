go build ./core/main.go
sudo supervisorctl restart memorial
tail -f output.log