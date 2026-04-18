package codex

import (
	"container/list"
	"sync"
)

type boundedLRU struct {
	mu           sync.Mutex
	ll           *list.List
	items        map[string]*list.Element
	maxBytes     int64
	currentBytes int64
}

type boundedLRUEntry struct {
	key   string
	size  int64
	value any
}

func newBoundedLRU(maxBytes int64) *boundedLRU {
	return &boundedLRU{
		ll:       list.New(),
		items:    make(map[string]*list.Element),
		maxBytes: maxBytes,
	}
}

func (c *boundedLRU) Get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	element, ok := c.items[key]
	if !ok {
		return nil, false
	}
	c.ll.MoveToFront(element)
	entry := element.Value.(*boundedLRUEntry)
	return entry.value, true
}

func (c *boundedLRU) Set(key string, value any, size int64) bool {
	if size <= 0 {
		size = 1
	}
	if c.maxBytes > 0 && size > c.maxBytes {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if element, ok := c.items[key]; ok {
		entry := element.Value.(*boundedLRUEntry)
		c.currentBytes += size - entry.size
		entry.value = value
		entry.size = size
		c.ll.MoveToFront(element)
		c.evictLocked()
		return true
	}

	entry := &boundedLRUEntry{
		key:   key,
		size:  size,
		value: value,
	}
	element := c.ll.PushFront(entry)
	c.items[key] = element
	c.currentBytes += size
	c.evictLocked()
	return true
}

func (c *boundedLRU) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	element, ok := c.items[key]
	if !ok {
		return
	}
	c.removeElementLocked(element)
}

func (c *boundedLRU) evictLocked() {
	if c.maxBytes <= 0 {
		return
	}
	for c.currentBytes > c.maxBytes {
		element := c.ll.Back()
		if element == nil {
			return
		}
		c.removeElementLocked(element)
	}
}

func (c *boundedLRU) removeElementLocked(element *list.Element) {
	c.ll.Remove(element)
	entry := element.Value.(*boundedLRUEntry)
	delete(c.items, entry.key)
	c.currentBytes -= entry.size
	if c.currentBytes < 0 {
		c.currentBytes = 0
	}
}
