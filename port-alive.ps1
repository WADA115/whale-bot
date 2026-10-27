param(
  [Parameter(Mandatory = $true)][int]$Port,
  [int]$TimeoutMs = 1200
)

# 判断本机端口上有没有人在监听。
# 为什么不用 Get-NetTCPConnection：那样在本机受限上下文里看不到别的会话的监听套接字，
# 会把正在跑的服务误判成"没跑"（实测过）。直接 TCP 连接探活最可靠。
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $task = $client.ConnectAsync('127.0.0.1', $Port)
  if ($task.Wait($TimeoutMs) -and $client.Connected) { exit 0 }
  exit 1
} catch {
  exit 1
} finally {
  if ($client) { try { $client.Dispose() } catch {} }
}
