============ 09:20 ============

The user made the following comment regarding line 104 of docs/api.md: 检查这个registerHandler和代码实际是不是一致？============ 09:20 ============

The user made the following comment regarding line 104 of docs/api.md: 检查这个registerHandler和代码实际是不是一致？

============ 09:24 ============

The user made the following comment regarding lines 112 through 115 of docs/api.md: 这个api第2个参数的回调函数里可以直接返回一个对象吗？

wrapper.registerHandler('/api/hello', (from, data) => {
  return { message: 'hello', received: data };
});

============ 09:24 ============

The user made the following comment regarding lines 112 through 115 of docs/api.md: 这个api第2个参数的回调函数里可以直接返回一个对象吗？

wrapper.registerHandler('/api/hello', (from, data) => {
  return { message: 'hello', received: data };
});

============ 09:29 ============

为什么直接返回对象、返回Promise都能正确处理？

============ 09:29 ============

为什么直接返回对象、返回Promise都能正确处理？

============ 10:22 ============

提交所有文件并推送git