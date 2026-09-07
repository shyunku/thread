package releasealerts

import "testing"

func TestBroadcastAllAndUnsubscribe(t *testing.T) {
	a, closeA := Subscribe()
	b, closeB := Subscribe()
	defer closeB()
	if Broadcast("2.0.0") != 2 {
		t.Fatal("must notify both connections")
	}
	for _, ch := range []<-chan Event{a, b} {
		select {
		case event := <-ch:
			if event.Topic != "release.available" || event.Version != "2.0.0" {
				t.Fatal(event)
			}
		default:
			t.Fatal("missing event")
		}
	}
	closeA()
	if Broadcast("2.0.1") != 1 {
		t.Fatal("closed connection retained")
	}
}

func TestSlowSubscriberDoesNotBlock(t *testing.T) {
	_, close := Subscribe()
	defer close()
	for i := 0; i < 100; i++ {
		Broadcast("2.0.0")
	}
}
