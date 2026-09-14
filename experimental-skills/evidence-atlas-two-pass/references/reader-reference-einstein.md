# Einstein 1905 讲解节选

仅选三处原文及其中文讲解，示范问题定位、同段多句意与文献溯源、公式回代和极限辨析。英文解释省略以减少重复；实际读本仍按 skill 交付双语内容。每个“讲解”对应一个独立入口；下面的标签仅帮助写作者辨认结构，不作为读本解析标题。新论文自行研究，不能复制本例证据编号、结论或依赖。

## 引文及真实依赖

解析文献编号：[1] Einstein, On the Electrodynamics of Moving Bodies (1905)，https://www.fourmilab.ch/etexts/einstein/specrel/www/ ；[2] 本篇质能短文；[3] Maxwell, A Dynamical Theory of the Electromagnetic Field (1865), Part III §§71–72，https://en.wikisource.org/wiki/A_Dynamical_Theory_of_the_Electromagnetic_Field/Part_III 。

本文质量差 → 本文低速动能系数 → 本文两系能量守恒 → 前作§8光能比。前作光能比依赖§7振幅比及§8光包体积比；两者进一步使用§3坐标变换、§6场变换。场能密度这一分支追至 Maxwell §§71–72的场能推导。最后一条是理论来源追溯，不能写成前作明列了该书目。Maxwell 的表达式建立在线性介质关系和电磁模型前提上；它不是实验测量的终点。

以下 evidence 链接使用本例的语义名称，供理解引用落点；当前工具创建证据返回的 ID 才用于新读本。

---

**原文**

The results of the previous investigation [Original note 1] lead to a very interesting conclusion, which is here to be deduced.

**译文**

此前研究〔原刊注1〕的结果导向一个很有意思的结论，本文将推导这一结论。

**句意锚点**

此前研究〔原刊注1〕的结果导向一个很有意思的结论，本文将推导这一结论。

**讲解**

这篇短文要把“光带走能量”与“物体失去惯性”联系起来。惯性在低速力学中由质量衡量：同样的力作用下，质量越大，速度越难改变。这里不能先假定质能关系，再把发出的光能除以 \(c^2\)；那样只是把结论写回前提。

爱因斯坦选择比较同一物体发光前后的动能。低速时 \(K=mv^2/2\)，如果前后速度相同，动能差中乘在 \(v^2/2\) 前面的量就是质量差。难处在于怎样从光能算出这个动能差。前作《动体电动力学》第 8 节提供光能在不同参考系中的变换 [1](evidence:sr-energy)，本文再把它代入两套能量守恒式 [2](evidence:balance)。原刊注1正是指向这篇前作，而不是泛指“相对论背景”。

---

**原文**

I based that investigation on the Maxwell-Hertz equations for empty space, together with the Maxwellian expression for the electromagnetic energy of space, and in addition the principle that:—

**译文**

那项研究以真空中的 Maxwell–Hertz 方程、Maxwell 关于空间电磁能的表达式，以及下述原理为基础：

**句意锚点**

那项研究以真空中的 Maxwell–Hertz 方程、

**讲解**

这里的场方程说明光怎样传播，并不是直接给出物体的质量。用现代真空 SI 记号，电场 \(\mathbf E\) 与磁场 \(\mathbf B\) 满足
\[\nabla\times\mathbf E=-\partial_t\mathbf B,\qquad \nabla\times\mathbf B=\mu_0\epsilon_0\partial_t\mathbf E.\]
在无电荷区域还有 \(\nabla\cdot\mathbf E=0\)。对第一式再取旋度，用 \(\nabla\times(\nabla\times\mathbf E)=\nabla(\nabla\cdot\mathbf E)-\nabla^2\mathbf E\)，得到
\[\nabla^2\mathbf E=\mu_0\epsilon_0\partial_t^2\mathbf E.\]
这就是波动方程，波速为 \(c=1/\sqrt{\mu_0\epsilon_0}\)。例如取一维波 \(E_y=A\cos(kx-\omega t)\)，代入后得到 \(\omega^2=c^2k^2\)；追踪一个相位不变的波峰，它的速度为 \(\omega/k=c\)。

前作第 6 节讨论这组真空方程在惯性系间的变换 [1](evidence:sr-field)。上面的现代记号是为了显露“场方程 → 波动方程 → 光速”的联系，不能把它误读成原刊使用了现代 SI 单位。

**句意锚点**

Maxwell 关于空间电磁能的表达式，以及下述原理为基础：

**讲解**

场强与能量之间还需要一条关系。Maxwell 在 1865 年论文第 72 段把建立电位移所做的功累加，得到电储能 [3](evidence:max-electric)。沿一个方向，他以 \(P\) 表示电作用量、\(f\) 表示电位移，并采用线性关系 \(P=kf\)。把电位移从零建立到 \(f\)，单位体积的功是
\[u_{\rm e}=\int_0^f k\tilde f\,d\tilde f=\frac12kf^2=\frac12Pf.\]
这解释了平方从哪里来：建立过程中作用量也逐渐增大，不能用最终作用量乘总位移；线性关系对应的平均作用量只有最终值的一半。这里的线性本构关系是采用的前提，不是这个积分又证明了它。

第 71 段还把磁能写成场量的空间积分 [3](evidence:max-magnetic)。用现代真空 Gaussian 记号合并电、磁两部分，瞬时能量密度为 \(u=(|\mathbf E|^2+|\mathbf B|^2)/(8\pi)\)。平面简谐波的两种场等强；若电场最大振幅为 \(A\)，周期平均 \(\langle\cos^2\rangle=1/2\)，因此平均总能量密度为
\[\bar u=\frac{A^2}{8\pi}.\]
这个量正是前作第 8 节采用的场能输入 [1](evidence:sr-density)。振幅平方决定能量密度，再乘光包体积才得到总能量。链条追到 Maxwell 的原始推导，是对这一理论依据的定位；不是声称爱因斯坦在此明确标注了 1865 年论文的编号。

---

**原文**

\[K_0-K_1=\frac12\frac L{c^2}v^2.\]

**译文**

\[K_0-K_1=\frac12\frac L{c^2}v^2.\]

**句意锚点**

\[K_0-K_1=\frac12\frac L{c^2}v^2.\]

**讲解**

把展开代回动能差，而不是只背下最后一行：
\[\begin{aligned}K_0-K_1&=L(\gamma-1)\\&=\frac{L}{2c^2}v^2+\frac{3L}{8c^4}v^4+\cdots.\end{aligned}\]
原文显示式中的等号应结合上一句理解为保留到二阶的表达。

低速时两种状态分别有 \(K_i(v)=m_iv^2/2+O(v^4)\)，且对称发光保证比较时使用同一个 v。于是
\[K_0-K_1=\frac12(m_0-m_1)v^2+O(v^4).\]
取非零 v，除以 \(v^2\) 再让 v 趋近零，两式中的高阶项都消失：
\[\frac12(m_0-m_1)=\lim_{v\to0}\frac{K_0-K_1}{v^2}=\frac{L}{2c^2}.\]
因此 \(m_0-m_1=L/c^2\)。低速极限是识别惯性质量系数的办法，不是说只要做了一次有限速度的截断近似，就自动证明了所有高阶运动性质 [2](evidence:low-speed)。
