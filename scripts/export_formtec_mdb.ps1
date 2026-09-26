param([string]$db, [string]$out)
$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$db;Mode=Read")
$conn.Open()
function Rows($sql) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql
    $da = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $t = New-Object System.Data.DataTable; [void]$da.Fill($t)
    $list = @()
    foreach ($row in $t.Rows) {
        $o = [ordered]@{}
        foreach ($c in $t.Columns) { $v = $row[$c.ColumnName]; if ($v -is [DBNull]) { $v = $null }; $o[$c.ColumnName] = $v }
        $list += [pscustomobject]$o
    }
    return ,$list
}
$result = [ordered]@{
    comps = Rows 'SELECT * FROM TA110'
    types = Rows 'SELECT * FROM TA120 ORDER BY SORT_ORDR'
    labels = Rows 'SELECT * FROM TA130 ORDER BY TYPE_NOXX, SORT_ORDR'
    mixed = Rows 'SELECT * FROM TA131'
}
$conn.Close()
$result | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $out
"ok"
