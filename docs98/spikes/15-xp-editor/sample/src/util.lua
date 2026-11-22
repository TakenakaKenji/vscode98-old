-- utility functions
local M = {}

function M.clamp(x, lo, hi)
	return math.max(lo, math.min(hi, x))
end

return M
