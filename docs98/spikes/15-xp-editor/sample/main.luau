-- sample: a Roblox-style Luau module
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("PlayerData")

type PlayerData = { coins: number, level: number }

local Module = {}
Module.__index = Module

function Module.new(player: Player): PlayerData
	local self = setmetatable({}, Module)
	self.player = player
	self.coins = 0
	return self
end

function Module:addCoins(n: number)
	self.coins += n
	if self.coins > 100 then
		print(`{self.player.Name} is rich`)
	end
end

Players.PlayerAdded:Connect(function(player)
	local data = Module.new(player)
	local ok, saved = pcall(function() return store:GetAsync(player.UserId) end)
	if ok and saved then data.coins = saved end
end)

return Module
