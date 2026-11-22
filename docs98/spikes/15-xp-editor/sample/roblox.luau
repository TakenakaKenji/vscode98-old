local Players = game:GetService("Players")
local function f(p: Player): number
	return p.UserId
end
print(f, workspace.CurrentCamera, Players)
