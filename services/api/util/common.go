package util

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"text/template"
	"time"
)

var (
	Big0 = big.NewInt(0)
	Big1 = big.NewInt(1)
	Big2 = big.NewInt(2)
	Big3 = big.NewInt(3)
)

// CurrentTimestampMilli returns current timestamp in milliseconds
func CurrentTimestampMilli() int64 {
	return time.Now().UnixNano() / int64(time.Millisecond)
}

func InterfaceToStruct(src interface{}, dst interface{}) error {
	jsonData, err := json.Marshal(src)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(jsonData, &dst); err != nil {
		return err
	}
	return nil
}

func ParseDuration(str string) (time.Duration, error) {
	// Duration string without last character (the unit)
	valueStr := str[:len(str)-1]

	// Parse the duration value as a float64
	value, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid duration string: %v", str)
	}

	// Get the duration unit (last character)
	unit := str[len(str)-1:]

	// Convert the duration value to a time.Duration based on the unit
	switch unit {
	case "c": // century
		return time.Duration(value * float64(time.Hour) * 24 * 365 * 100), nil
	case "y": // year
		return time.Duration(value * float64(time.Hour) * 24 * 365), nil
	case "w": // week
		return time.Duration(value * float64(time.Hour) * 24 * 7), nil
	case "d": // day
		return time.Duration(value * float64(time.Hour) * 24), nil
	case "h": // hour
		return time.Duration(value * float64(time.Hour)), nil
	case "m": // minute
		return time.Duration(value * float64(time.Minute)), nil
	case "s": // second
		return time.Duration(value * float64(time.Second)), nil
	case "ms": // millisecond
		return time.Duration(value * float64(time.Millisecond)), nil
	default:
		return 0, fmt.Errorf("unknown duration unit: %v", unit)
	}
}

func ClipString(str string, length int) string {
	runes := []rune(str)
	end := length
	if end > len(runes) {
		end = len(runes)
	}
	if len(runes) > length {
		return string(runes[0:end]) + "..."
	}
	return str
}

func DotToHtml(dot string) (string, error) {
	type Data struct {
		Dot string
	}

	tmpl := `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>State Visualization</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/d3-graphviz/5.1.0/d3-graphviz.min.js"></script>
	<style>
		html, body {
			margin: 0
			width: 100%;
			height: 100%;
			overflow: hidden;
		}
        svg {
            width: 100vw;
            height: 100vh;
        }
    </style>
<body>
    <div id="graph" style="text-align: center;"></div>
    <script>
		d3.select("#graph").graphviz().renderDot(` + "`" + `{{.Dot}}` + "`" + `);
    </script>
</body>
</html>
	`
	t, err := template.New("webpage").Parse(tmpl)
	if err != nil {
		return "", err
	}

	data := Data{Dot: dot}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	if err != nil {
		return "", err
	}
	return buf.String(), nil
}
