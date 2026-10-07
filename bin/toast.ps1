# Shows a Windows reminder toast (stays on screen until dismissed).
# Read from stdin by `powershell.exe -Command -`, so every statement is one line.
# Text comes from $env:CW_TITLE and $env:CW_BODY; $env:CW_SOUND = 1 plays the reminder sound.
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast scenario="reminder"><visual><binding template="ToastGeneric"><text/><text/></binding></visual><actions><action content="Dismiss" arguments="dismiss" activationType="system"/></actions><audio silent="true"/></toast>')
$t = $x.GetElementsByTagName('text'); $t.Item(0).InnerText = $env:CW_TITLE; $t.Item(1).InnerText = $env:CW_BODY
if ($env:CW_SOUND -eq '1') { $a = $x.GetElementsByTagName('audio').Item(0); $a.RemoveAttribute('silent'); $a.SetAttribute('src', 'ms-winsoundevent:Notification.Reminder') }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
'shown'
