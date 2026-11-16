# Notes on attention

Scaled dot-product attention:

$$
\operatorname{Attention}(Q, K, V) = \operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
$$

```python
import numpy as np

def attention(q, k, v):
    scores = q @ k.T / np.sqrt(k.shape[-1])
    weights = np.exp(scores - scores.max(-1, keepdims=True))
    weights /= weights.sum(-1, keepdims=True)
    return weights @ v
```

> [!WARNING]
> Without the $\sqrt{d_k}$ scaling, softmax saturates for large dimensions.
