package v1

import (
	"github.com/gin-gonic/gin"
	"memorial_app_server/service/state"
	"memorial_app_server/util"
	"strconv"
)

func StateHash(c *gin.Context) {
	// get block number from query
	blockNumber := c.Query("block_number")

	resp := make(map[string]string)
	if blockNumber == "" {
		// get all chains
		cluster := state.Chains
		for uid, chain := range *cluster {
			resp[uid] = chain.GetLastState().Hash().Hex()
		}
	} else {
		bn, _ := strconv.Atoi(blockNumber)
		cluster := state.Chains
		for uid, chain := range *cluster {
			block, _ := chain.GetBlockByNumber(int64(bn))
			resp[uid] = block.State.Hash().Hex()
		}
	}
	c.JSON(200, resp)
}

func State(c *gin.Context) {
	// get block number from query
	blockNumber := c.Query("block_number")

	resp := make(map[string]state.State)
	if blockNumber == "" {
		// get all chains
		cluster := state.Chains
		for uid, chain := range *cluster {
			resp[uid] = *chain.GetLastState()
		}
	} else {
		bn, _ := strconv.Atoi(blockNumber)
		cluster := state.Chains
		for uid, chain := range *cluster {
			block, _ := chain.GetBlockByNumber(int64(bn))
			blockState := block.State
			resp[uid] = *blockState
		}
	}
	c.JSON(200, resp)
}

func Transaction(c *gin.Context) {
	// get block number from query
	blockNumber := c.Query("block_number")

	resp := make(map[string]state.Transaction)
	if blockNumber == "" {
		// get all chains
		cluster := state.Chains
		for uid, chain := range *cluster {
			lastBn := chain.GetLastBlockNumber()
			block, _ := chain.GetBlockByNumber(lastBn)
			tx := block.Updates.SrcTx
			resp[uid] = *tx
		}
	} else {
		bn, _ := strconv.Atoi(blockNumber)
		cluster := state.Chains
		for uid, chain := range *cluster {
			block, _ := chain.GetBlockByNumber(int64(bn))
			tx := block.Updates.SrcTx
			resp[uid] = *tx
		}
	}
	c.JSON(200, resp)
}

func CurrentChains(c *gin.Context) {
	c.JSON(200, state.Chains)
}

func Task(c *gin.Context) {
	taskId := c.Query("task_id")
	type info struct {
		BlockNumber int64                 `json:"block_number"`
		Task        state.DirectionalTask `json:"task"`
	}
	resp := make(map[string]info)
	for uid, chain := range *state.Chains {
		lastState := chain.GetLastState()
		lastBlockNumber := chain.GetLastBlockNumber()
		tasks, err := lastState.SortTasks()
		if err != nil {
			c.JSON(500, err)
			return
		}

		resp[uid] = info{
			BlockNumber: lastBlockNumber,
			Task:        tasks[taskId],
		}
	}
	c.JSON(200, resp)
}

func Diagram(c *gin.Context) {
	uid := c.Query("user_id")
	if uid == "" {
		c.JSON(400, "user_id is required")
		return
	}
	chain, ok := (*state.Chains)[uid]
	if !ok {
		c.JSON(404, "user_id not found")
		return
	}
	lastState := chain.GetLastState()
	diagram, err := lastState.Diagram()
	if err != nil {
		c.JSON(500, err)
		return
	}
	html, err := util.DotToHtml(diagram)
	if err != nil {
		c.JSON(500, err)
		return
	}
	c.Data(200, "text/html", []byte(html))
}

func UseTestRouter(g *gin.RouterGroup) {
	sg := g.Group("/test")
	sg.GET("/state", State)
	sg.GET("/chains", CurrentChains)
	sg.GET("/transaction", Transaction)
	sg.GET("/task", Task)
	sg.GET("/diagram", Diagram)
}
