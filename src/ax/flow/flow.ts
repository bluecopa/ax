/* eslint-disable @typescript-eslint/no-explicit-any, functional/prefer-immutable-types */
import type { AxAIService } from '../ai/types.js'
import { AxGen } from '../dsp/generate.js'
import { AxProgram, type AxProgramForwardOptions } from '../dsp/program.js'
import { AxSignature } from '../dsp/sig.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from '../dsp/types.js'

// Type for state object that flows through the pipeline
type AxFlowState = Record<string, unknown>

// Type for node definitions in the flow
interface AxFlowNodeDefinition {
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
}

// Type for flow step functions
type AxFlowStepFunction = (
  state: AxFlowState,
  context: Readonly<{
    mainAi: AxAIService
    mainOptions?: AxProgramForwardOptions
  }>
) => Promise<AxFlowState> | AxFlowState

// Type for dynamic context overrides
interface AxFlowDynamicContext {
  ai?: AxAIService
  options?: AxProgramForwardOptions
}

// =============================================================================
// ADVANCED TYPE SYSTEM FOR TYPE-SAFE CHAINING
// =============================================================================

// Helper type to extract input type from an AxGen instance
type GetGenIn<T extends AxGen<AxGenIn, AxGenOut>> =
  T extends AxGen<infer IN, AxGenOut> ? IN : never

// Helper type to extract output type from an AxGen instance
type GetGenOut<T extends AxGen<AxGenIn, AxGenOut>> =
  T extends AxGen<AxGenIn, infer OUT> ? OUT : never

// Helper type to create an AxGen type from a signature string
// This is a simplified version - in practice, you'd need more sophisticated parsing
type InferAxGen<TSig extends string> = TSig extends string
  ? AxGen<AxGenIn, AxGenOut>
  : never

// Helper type to create result key name from node name
type NodeResultKey<TNodeName extends string> = `${TNodeName}Result`

// Helper type to add node result to state
type AddNodeResult<
  TState extends AxFlowState,
  TNodeName extends string,
  TNodeOut extends AxGenOut,
> = TState & { [K in NodeResultKey<TNodeName>]: TNodeOut }

// =============================================================================
// TYPED SUB-CONTEXT INTERFACES
// =============================================================================

// Type for parallel branch functions with typed context
// NOTE: The `any` here is necessary because we need to support AxGen with any input/output types
type AxFlowTypedParallelBranch<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> = (
  subFlow: AxFlowTypedSubContext<TNodes, TState>
) => AxFlowTypedSubContext<TNodes, AxFlowState>

// Type for typed sub-flow context used in parallel execution
// NOTE: The `any` here is necessary for the same reason as above
interface AxFlowTypedSubContext<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> {
  execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlowTypedSubContext<
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  >

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState>

  executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService
      mainOptions?: AxProgramForwardOptions
    }>
  ): Promise<AxFlowState>
}

// Legacy untyped interfaces for backward compatibility
type AxFlowParallelBranch = (subFlow: AxFlowSubContext) => AxFlowSubContext

interface AxFlowSubContext {
  execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this
  map(transform: (state: AxFlowState) => AxFlowState): this
  executeSteps(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: AxAIService
      mainOptions?: AxProgramForwardOptions
    }>
  ): Promise<AxFlowState>
}

// Type for branch context
interface AxFlowBranchContext {
  predicate: (state: AxFlowState) => unknown
  branches: Map<unknown, AxFlowStepFunction[]>
  currentBranchValue?: unknown
}

// =============================================================================
// AUTOMATIC DEPENDENCY ANALYSIS AND PARALLELIZATION
// =============================================================================

// Type for execution step metadata
interface AxFlowExecutionStep {
  type: 'execute' | 'map' | 'other'
  nodeName?: string
  dependencies: string[]
  produces: string[]
  stepFunction: AxFlowStepFunction
  stepIndex: number
}

// Type for parallel execution groups
interface AxFlowParallelGroup {
  level: number
  steps: AxFlowExecutionStep[]
}

// Configuration for automatic parallelization
interface AxFlowAutoParallelConfig {
  enabled: boolean
}

/**
 * Analyzes mapping functions to extract state dependencies
 */
class AxFlowDependencyAnalyzer {
  /**
   * Analyzes a mapping function to determine which state fields it depends on
   */
  analyzeMappingDependencies(
    mapping: (state: any) => any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _nodeName: string
  ): string[] {
    const dependencies: string[] = []

    // Method 1: Static analysis of function source
    const source = mapping.toString()
    const stateAccessMatches = Array.from(source.matchAll(/state\.(\w+)/g))
    for (const match of stateAccessMatches) {
      if (match[1] && !dependencies.includes(match[1])) {
        dependencies.push(match[1])
      }
    }

    // Method 2: Proxy-based tracking (fallback for complex cases)
    if (dependencies.length === 0) {
      try {
        const tracker = this.createDependencyTracker(dependencies)
        mapping(tracker)
      } catch {
        // Expected - we're just tracking access patterns
      }
    }

    return dependencies
  }

  private createDependencyTracker(dependencies: string[]): any {
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (typeof prop === 'string' && !dependencies.includes(prop)) {
            dependencies.push(prop)
          }
          // Return another proxy for nested access
          return new Proxy(
            {},
            {
              get: () => undefined,
            }
          )
        },
      }
    )
  }
}

/**
 * Builds and manages the execution plan with automatic parallelization
 */
class AxFlowExecutionPlanner {
  private steps: AxFlowExecutionStep[] = []
  private parallelGroups: AxFlowParallelGroup[] = []
  private readonly analyzer = new AxFlowDependencyAnalyzer()
  private initialFields: Set<string> = new Set()

  /**
   * Adds an execution step to the plan
   */
  addExecutionStep(
    stepFunction: AxFlowStepFunction,
    nodeName?: string,
    mapping?: (state: any) => any
  ): void {
    let dependencies: string[] = []
    let produces: string[] = []
    let type: 'execute' | 'map' | 'other' = 'other'

    if (nodeName && mapping) {
      type = 'execute'
      dependencies = this.analyzer.analyzeMappingDependencies(mapping, nodeName)
      produces = [`${nodeName}Result`]
    } else if (stepFunction.toString().includes('transform(')) {
      type = 'map'
      // Map steps are harder to analyze statically, assume they depend on all previous steps
      dependencies = this.getAllProducedFields()
    }

    const step: AxFlowExecutionStep = {
      type,
      nodeName,
      dependencies,
      produces,
      stepFunction,
      stepIndex: this.steps.length,
    }

    this.steps.push(step)
    // Don't rebuild parallel groups during construction - only after initial fields are set
    // this.rebuildParallelGroups()
  }

  /**
   * Sets the initial fields and rebuilds parallel groups
   */
  setInitialFields(fields: string[]): void {
    this.initialFields = new Set(fields)
    this.rebuildParallelGroups()
  }

  /**
   * Rebuilds the parallel execution groups based on dependencies
   */
  private rebuildParallelGroups(): void {
    this.parallelGroups = []
    const processedSteps = new Set<number>()
    const availableFields = new Set<string>(this.initialFields)
    let currentLevel = 0

    while (processedSteps.size < this.steps.length) {
      const currentLevelSteps: AxFlowExecutionStep[] = []

      // Find all steps that can run at this level
      for (const step of this.steps) {
        if (processedSteps.has(step.stepIndex)) continue

        // Check if all dependencies are available
        const canRun =
          step.dependencies.length === 0 ||
          step.dependencies.every((dep) => availableFields.has(dep))

        if (canRun) {
          currentLevelSteps.push(step)
          processedSteps.add(step.stepIndex)
        }
      }

      if (currentLevelSteps.length > 0) {
        // Add all produced fields from this level to available fields
        for (const step of currentLevelSteps) {
          step.produces.forEach((field) => availableFields.add(field))
        }

        this.parallelGroups.push({
          level: currentLevel,
          steps: currentLevelSteps,
        })
        currentLevel++
      } else {
        // No progress made - break to avoid infinite loop
        break
      }
    }
  }

  /**
   * Gets all fields produced by previous steps
   */
  private getAllProducedFields(): string[] {
    const fields: string[] = []
    for (const step of this.steps) {
      fields.push(...step.produces)
    }
    return fields
  }

  /**
   * Creates optimized execution function
   */
  createOptimizedExecution(): AxFlowStepFunction[] {
    const optimizedSteps: AxFlowStepFunction[] = []

    for (const group of this.parallelGroups) {
      if (group.steps.length === 1) {
        // Single step - execute directly
        const step = group.steps[0]
        if (step) {
          optimizedSteps.push(step.stepFunction)
        }
      } else if (group.steps.length > 1) {
        // Multiple steps - execute in parallel
        const parallelStep: AxFlowStepFunction = async (state, context) => {
          const promises = group.steps.map((step) =>
            step.stepFunction(state, context)
          )

          const results = await Promise.all(promises)

          // Merge all results
          let mergedState = state
          for (const result of results) {
            mergedState = { ...mergedState, ...result }
          }

          return mergedState
        }

        optimizedSteps.push(parallelStep)
      }
    }

    return optimizedSteps
  }

  /**
   * Gets execution plan info for debugging
   */
  getExecutionPlan(): {
    totalSteps: number
    parallelGroups: number
    maxParallelism: number
    steps: AxFlowExecutionStep[]
    groups: AxFlowParallelGroup[]
  } {
    return {
      totalSteps: this.steps.length,
      parallelGroups: this.parallelGroups.length,
      maxParallelism: Math.max(
        ...this.parallelGroups.map((g) => g.steps.length),
        0
      ),
      steps: this.steps,
      groups: this.parallelGroups,
    }
  }
}

/**
 * AxFlow - A fluent, chainable API for building and orchestrating complex, stateful AI programs.
 *
 * Now with advanced type-safe chaining where each method call evolves the type information,
 * providing compile-time type safety and superior IntelliSense.
 *
 * @example
 * ```typescript
 * const flow = new AxFlow<{ topic: string }, { finalAnswer: string }>()
 *   .node('summarizer', 'text:string -> summary:string')
 *   .node('critic', 'summary:string -> critique:string')
 *   .execute('summarizer', state => ({ text: `About ${state.topic}` })) // state is { topic: string }
 *   .execute('critic', state => ({ summary: state.summarizerResult.summary })) // state evolves!
 *   .map(state => ({ finalAnswer: state.criticResult.critique })) // fully typed!
 *
 * const result = await flow.forward(ai, { topic: "AI safety" })
 * ```
 */
export class AxFlow<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  // NOTE: The `any` here is necessary because TNodes must accommodate AxGen instances with various input/output types
  TNodes extends Record<string, AxGen<any, any>> = Record<string, never>, // Node registry for type tracking
  TState extends AxFlowState = IN, // Current evolving state type
> extends AxProgram<IN, OUT> {
  private readonly nodes: Map<string, AxFlowNodeDefinition> = new Map()
  private readonly flowDefinition: AxFlowStepFunction[] = []
  private readonly nodeGenerators: Map<
    string,
    AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
  > = new Map()
  private readonly loopStack: number[] = []
  private readonly stepLabels: Map<string, number> = new Map()
  private branchContext: AxFlowBranchContext | null = null

  // Automatic parallelization components
  private readonly autoParallelConfig: AxFlowAutoParallelConfig
  private readonly executionPlanner = new AxFlowExecutionPlanner()

  constructor(
    signature: NonNullable<
      ConstructorParameters<typeof AxSignature>[0]
    > = 'userInput:string -> flowOutput:string',
    options?: {
      autoParallel?: boolean
    }
  ) {
    super(signature)
    this.autoParallelConfig = {
      enabled: options?.autoParallel !== false, // Default to true
    }
  }

  /**
   * Declares a reusable computational node using a signature string.
   * Returns a new AxFlow type that tracks this node in the TNodes registry.
   *
   * @param name - The name of the node
   * @param signature - Signature string in the same format as AxSignature
   * @param options - Optional program forward options (same as AxGen)
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * flow.node('summarizer', 'text:string -> summary:string')
   * flow.node('analyzer', 'text:string -> analysis:string, confidence:number', { debug: true })
   * ```
   */
  public node<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: InferAxGen<TSig> }, // Add new node to registry
    TState // State unchanged
  >

  /**
   * Declares a reusable computational node using an AxSignature instance.
   * This allows using pre-configured signatures in the flow.
   *
   * @param name - The name of the node
   * @param signature - AxSignature instance to use for this node
   * @param options - Optional program forward options (same as AxGen)
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * const sig = new AxSignature('text:string -> summary:string')
   * flow.node('summarizer', sig, { temperature: 0.1 })
   * ```
   */
  public node<TName extends string>(
    name: TName,
    signature: AxSignature,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> }, // Add new node to registry
    TState // State unchanged
  >

  /**
   * Declares a reusable computational node using an existing AxGen instance.
   * This allows reusing pre-configured generators in the flow.
   *
   * @param name - The name of the node
   * @param axgenInstance - Existing AxGen instance to use for this node
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * const summarizer = new AxGen('text:string -> summary:string', { temperature: 0.1 })
   * flow.node('summarizer', summarizer)
   * ```
   */
  public node<TName extends string, TGen extends AxGen<any, any>>(
    name: TName,
    axgenInstance: TGen
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: TGen }, // Add new node to registry with exact type
    TState // State unchanged
  >

  /**
   * Declares a reusable computational node using a class that extends AxProgram.
   * This allows using custom program classes in the flow.
   *
   * @param name - The name of the node
   * @param programClass - Class that extends AxProgram to use for this node
   * @returns New AxFlow instance with updated TNodes type
   *
   * @example
   * ```typescript
   * class CustomProgram extends AxProgram<{ input: string }, { output: string }> {
   *   async forward(ai, values) { return { output: values.input.toUpperCase() } }
   * }
   * flow.node('custom', CustomProgram)
   * ```
   */
  public node<
    TName extends string,
    TProgram extends new () => AxProgram<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: InstanceType<TProgram> }, // Add new node to registry with exact type
    TState // State unchanged
  >

  // Implementation
  public node<TName extends string>(
    name: TName,
    signatureOrAxGenOrClass:
      | string
      | AxSignature
      | AxGen<any, any>
      | (new () => AxProgram<any, any>),
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: any }, // Using any here as the implementation handles all cases
    TState
  > {
    if (signatureOrAxGenOrClass instanceof AxGen) {
      // Using existing AxGen instance
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      })

      // Store the existing AxGen instance
      this.nodeGenerators.set(
        name,
        signatureOrAxGenOrClass as AxGen<AxGenIn, AxGenOut>
      )
    } else if (signatureOrAxGenOrClass instanceof AxSignature) {
      // Using AxSignature instance
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      })

      // Create and store the AxGen instance for this node using the signature
      this.nodeGenerators.set(name, new AxGen(signatureOrAxGenOrClass, options))
    } else if (
      typeof signatureOrAxGenOrClass === 'function' &&
      signatureOrAxGenOrClass.prototype instanceof AxProgram
    ) {
      // Using a class that extends AxProgram
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      })

      // Create an instance of the program class and store it directly
      const programInstance = new signatureOrAxGenOrClass()
      this.nodeGenerators.set(name, programInstance)
    } else if (typeof signatureOrAxGenOrClass === 'string') {
      // Using signature string (original behavior)
      const signature = signatureOrAxGenOrClass

      // Validate that signature is provided
      if (!signature) {
        throw new Error(
          `Invalid signature for node '${name}': signature cannot be empty`
        )
      }

      // Store node definition (simplified since we're using standard signatures)
      this.nodes.set(name, {
        inputs: {},
        outputs: {},
      })

      // Create and store the AxGen instance for this node with the same arguments as AxGen
      this.nodeGenerators.set(name, new AxGen(signature, options))
    } else {
      throw new Error(
        `Invalid second argument for node '${name}': expected string, AxSignature, AxGen instance, or class extending AxProgram`
      )
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    // The runtime value is the same object, but TypeScript can't track the evolving generic types
    return this as any
  }

  /**
   * Short alias for node() - supports signature strings, AxSignature instances, AxGen instances, and program classes
   */
  public n<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InferAxGen<TSig> }, TState>

  public n<TName extends string>(
    name: TName,
    signature: AxSignature,
    options?: Readonly<AxProgramForwardOptions>
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  >

  public n<TName extends string, TGen extends AxGen<any, any>>(
    name: TName,
    axgenInstance: TGen
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: TGen }, TState>

  public n<
    TName extends string,
    TProgram extends new () => AxProgram<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InstanceType<TProgram> }, TState>

  public n<TName extends string>(
    name: TName,
    signatureOrAxGenOrClass:
      | string
      | AxSignature
      | AxGen<any, any>
      | (new () => AxProgram<any, any>),
    options?: Readonly<AxProgramForwardOptions>
  ): any {
    return this.node(name, signatureOrAxGenOrClass as any, options)
  }

  /**
   * Applies a synchronous transformation to the state object.
   * Returns a new AxFlow type with the evolved state.
   *
   * @param transform - Function that takes the current state and returns a new state
   * @returns New AxFlow instance with updated TState type
   *
   * @example
   * ```typescript
   * flow.map(state => ({ ...state, processedText: state.text.toLowerCase() }))
   * ```
   */
  public map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    const step = (state: AxFlowState) => {
      return transform(state as TState)
    }

    if (this.branchContext?.currentBranchValue !== undefined) {
      // We're inside a branch - add to current branch
      const currentBranch =
        this.branchContext.branches.get(
          this.branchContext.currentBranchValue
        ) || []
      currentBranch.push(step)
      this.branchContext.branches.set(
        this.branchContext.currentBranchValue,
        currentBranch
      )
    } else {
      // Normal execution - add to main flow
      this.flowDefinition.push(step)

      // Add to execution planner for automatic parallelization
      if (this.autoParallelConfig.enabled) {
        this.executionPlanner.addExecutionStep(step)
      }
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as unknown as AxFlow<IN, OUT, TNodes, TNewState>
  }

  /**
   * Short alias for map()
   */
  public m<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    return this.map(transform)
  }

  /**
   * Labels a step for later reference (useful for feedback loops).
   *
   * @param label - The label to assign to the current step position
   * @returns this (for chaining, no type change)
   *
   * @example
   * ```typescript
   * flow.label('retry-point')
   *   .execute('queryGen', ...)
   * ```
   */
  public label(label: string): this {
    if (this.branchContext?.currentBranchValue !== undefined) {
      throw new Error('Cannot create labels inside branch blocks')
    }
    this.stepLabels.set(label, this.flowDefinition.length)
    return this
  }

  /**
   * Short alias for label()
   */
  public l(label: string): this {
    return this.label(label)
  }

  /**
   * Executes a previously defined node with full type safety.
   * The node name must exist in TNodes, and the mapping function is typed based on the node's signature.
   *
   * @param nodeName - The name of the node to execute (must exist in TNodes)
   * @param mapping - Typed function that takes the current state and returns the input for the node
   * @param dynamicContext - Optional object to override the AI service or options for this specific step
   * @returns New AxFlow instance with TState augmented with the node's result
   *
   * @example
   * ```typescript
   * flow.execute('summarizer', state => ({ text: state.originalText }), { ai: cheapAI })
   * ```
   */
  public execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlow<
    IN,
    OUT,
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    if (!this.nodes.has(nodeName)) {
      throw new Error(
        `Node '${nodeName}' not found. Make sure to define it with .node() first.`
      )
    }

    const nodeProgram = this.nodeGenerators.get(nodeName)
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`)
    }

    const step = async (
      state: AxFlowState,
      context: Readonly<{
        mainAi: AxAIService
        mainOptions?: AxProgramForwardOptions
      }>
    ) => {
      // Determine AI service and options using fallback logic
      const ai = dynamicContext?.ai ?? context.mainAi
      const options = dynamicContext?.options ?? context.mainOptions

      // Map the state to node inputs (with type safety)
      const nodeInputs = mapping(state as TState)

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      })

      // Merge result back into state under a key like `${nodeName}Result`
      return {
        ...state,
        [`${nodeName}Result`]: result,
      }
    }

    if (this.branchContext?.currentBranchValue !== undefined) {
      // We're inside a branch - add to current branch
      const currentBranch =
        this.branchContext.branches.get(
          this.branchContext.currentBranchValue
        ) || []
      currentBranch.push(step)
      this.branchContext.branches.set(
        this.branchContext.currentBranchValue,
        currentBranch
      )
    } else {
      // Normal execution - add to main flow
      this.flowDefinition.push(step)

      // Add to execution planner for automatic parallelization
      if (this.autoParallelConfig.enabled) {
        this.executionPlanner.addExecutionStep(step, nodeName, mapping)
      }
    }

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as AxFlow<
      IN,
      OUT,
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >
  }

  /**
   * Short alias for execute()
   */
  public e<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlow<
    IN,
    OUT,
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    return this.execute(nodeName, mapping, dynamicContext)
  }

  /**
   * Starts a conditional branch based on a predicate function.
   *
   * @param predicate - Function that takes state and returns a value to branch on
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.branch(state => state.qualityResult.needsMoreInfo)
   *   .when(true)
   *     .execute('queryGen', ...)
   *   .when(false)
   *     .execute('answer', ...)
   *   .merge()
   * ```
   */
  public branch(predicate: (state: TState) => unknown): this {
    if (this.branchContext) {
      throw new Error('Nested branches are not supported')
    }

    this.branchContext = {
      predicate: (state: AxFlowState) => predicate(state as TState),
      branches: new Map(),
      currentBranchValue: undefined,
    }

    return this
  }

  /**
   * Short alias for branch()
   */
  public b(predicate: (state: TState) => unknown): this {
    return this.branch(predicate)
  }

  /**
   * Defines a branch case for the current branch context.
   *
   * @param value - The value to match against the branch predicate result
   * @returns this (for chaining)
   */
  public when(value: unknown): this {
    if (!this.branchContext) {
      throw new Error('when() called without matching branch()')
    }

    this.branchContext.currentBranchValue = value
    this.branchContext.branches.set(value, [])

    return this
  }

  /**
   * Short alias for when()
   */
  public w(value: unknown): this {
    return this.when(value)
  }

  /**
   * Ends the current branch and merges all branch paths back into the main flow.
   * Optionally specify the explicit merged state type for better type safety.
   *
   * @param explicitMergedType - Optional type hint for the merged state (defaults to current TState)
   * @returns AxFlow instance with the merged state type
   *
   * @example
   * ```typescript
   * // Default behavior - preserves current TState
   * flow.branch(state => state.type)
   *   .when('simple').execute('simpleProcessor', ...)
   *   .when('complex').execute('complexProcessor', ...)
   *   .merge()
   *
   * // Explicit type - specify exact merged state shape
   * flow.branch(state => state.type)
   *   .when('simple').map(state => ({ result: state.simpleResult, method: 'simple' }))
   *   .when('complex').map(state => ({ result: state.complexResult, method: 'complex' }))
   *   .merge<{ result: string; method: string }>()
   * ```
   */
  public merge<TMergedState extends AxFlowState = TState>(): AxFlow<
    IN,
    OUT,
    TNodes,
    TMergedState
  > {
    if (!this.branchContext) {
      throw new Error('merge() called without matching branch()')
    }

    const branchContext = this.branchContext
    this.branchContext = null

    // Add the branch execution step to main flow
    this.flowDefinition.push(async (state, context) => {
      const branchValue = branchContext.predicate(state)
      const branchSteps = branchContext.branches.get(branchValue)

      if (!branchSteps) {
        // No matching branch - return state unchanged
        return state
      }

      // Execute all steps in the matched branch
      let currentState = state
      for (const step of branchSteps) {
        currentState = await step(currentState, context)
      }

      return currentState
    })

    // Cast `this` to preserve runtime object while updating compile-time type information.
    return this as unknown as AxFlow<IN, OUT, TNodes, TMergedState>
  }

  /**
   * Short alias for merge()
   */
  public mg<TMergedState extends AxFlowState = TState>(): AxFlow<
    IN,
    OUT,
    TNodes,
    TMergedState
  > {
    return this.merge<TMergedState>()
  }

  /**
   * Executes multiple operations in parallel and merges their results.
   * Both typed and legacy untyped branches are supported.
   *
   * @param branches - Array of functions that define parallel operations
   * @returns Object with merge method for combining results
   *
   * @example
   * ```typescript
   * flow.parallel([
   *   subFlow => subFlow.execute('retrieve1', state => ({ query: state.query1 })),
   *   subFlow => subFlow.execute('retrieve2', state => ({ query: state.query2 })),
   *   subFlow => subFlow.execute('retrieve3', state => ({ query: state.query3 }))
   * ]).merge('documents', (docs1, docs2, docs3) => [...docs1, ...docs2, ...docs3])
   * ```
   */
  public parallel(
    branches: (
      | AxFlowParallelBranch
      | AxFlowTypedParallelBranch<TNodes, TState>
    )[]
  ): {
    merge<T, TResultKey extends string>(
      resultKey: TResultKey,
      mergeFunction: (...results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>
  } {
    const parallelStep = async (
      state: AxFlowState,
      context: Readonly<{
        mainAi: AxAIService
        mainOptions?: AxProgramForwardOptions
      }>
    ) => {
      // Execute all branches in parallel
      const promises = branches.map(async (branchFn) => {
        // Create a sub-context for this branch
        const subContext = new AxFlowSubContextImpl(this.nodeGenerators)
        // NOTE: Type assertion needed here because we support both typed and untyped branch functions
        const populatedSubContext = branchFn(
          subContext as AxFlowSubContext & AxFlowTypedSubContext<TNodes, TState>
        )

        // Execute the sub-context steps
        return await populatedSubContext.executeSteps(state, context)
      })

      const results = await Promise.all(promises)

      // Store results for merging
      return {
        ...state,
        _parallelResults: results,
      }
    }

    this.flowDefinition.push(parallelStep)

    return {
      merge: <T, TResultKey extends string>(
        resultKey: TResultKey,
        mergeFunction: (...results: unknown[]) => T
      ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }> => {
        this.flowDefinition.push((state) => {
          const results = state._parallelResults
          if (!Array.isArray(results)) {
            throw new Error('No parallel results found for merge')
          }

          const mergedValue = mergeFunction(...results)
          const newState = { ...state }
          delete newState._parallelResults
          newState[resultKey] = mergedValue

          return newState
        })

        // NOTE: This type assertion is necessary for the type-level programming pattern
        return this as AxFlow<
          IN,
          OUT,
          TNodes,
          TState & { [K in TResultKey]: T }
        >
      },
    }
  }

  /**
   * Short alias for parallel()
   */
  public p(
    branches: (
      | AxFlowParallelBranch
      | AxFlowTypedParallelBranch<TNodes, TState>
    )[]
  ): {
    merge<T, TResultKey extends string>(
      resultKey: TResultKey,
      mergeFunction: (...results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>
  } {
    return this.parallel(branches)
  }

  /**
   * Creates a feedback loop that jumps back to a labeled step if a condition is met.
   *
   * @param condition - Function that returns true to trigger the feedback loop
   * @param targetLabel - The label to jump back to
   * @param maxIterations - Maximum number of iterations to prevent infinite loops (default: 10)
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.label('retry-point')
   *   .execute('answer', ...)
   *   .execute('qualityCheck', ...)
   *   .feedback(state => state.qualityCheckResult.confidence < 0.7, 'retry-point')
   * ```
   */
  public feedback(
    condition: (state: TState) => boolean,
    targetLabel: string,
    maxIterations: number = 10
  ): this {
    if (!this.stepLabels.has(targetLabel)) {
      throw new Error(
        `Label '${targetLabel}' not found. Make sure to define it with .label() before the feedback point.`
      )
    }

    const targetIndex = this.stepLabels.get(targetLabel)!

    // Capture the current flow definition length before adding the feedback step
    // This prevents the feedback step from executing itself recursively
    const feedbackStepIndex = this.flowDefinition.length

    this.flowDefinition.push(async (state, context) => {
      let currentState = state
      let iterations = 1 // Start at 1 since we've already executed once before reaching feedback

      // Add iteration tracking to state if not present
      const iterationKey = `_feedback_${targetLabel}_iterations`
      if (typeof currentState[iterationKey] !== 'number') {
        currentState = { ...currentState, [iterationKey]: 1 } // Initial execution counts as iteration 1
      }

      // Check if we should loop back (iterations < maxIterations since initial execution counts as 1)
      while (condition(currentState as TState) && iterations < maxIterations) {
        iterations++
        currentState = { ...currentState, [iterationKey]: iterations }

        // Execute steps from target index to just before the feedback step
        // Use feedbackStepIndex to avoid including the feedback step itself
        for (let i = targetIndex; i < feedbackStepIndex; i++) {
          const step = this.flowDefinition[i]
          if (step) {
            currentState = await step(currentState, context)
          }
        }
      }

      return currentState
    })

    return this
  }

  /**
   * Short alias for feedback()
   */
  public fb(
    condition: (state: TState) => boolean,
    targetLabel: string,
    maxIterations: number = 10
  ): this {
    return this.feedback(condition, targetLabel, maxIterations)
  }

  /**
   * Marks the beginning of a loop block.
   *
   * @param condition - Function that takes the current state and returns a boolean
   * @param maxIterations - Maximum number of iterations to prevent infinite loops (default: 100)
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * flow.while(state => state.iterations < 3, 10)
   *   .map(state => ({ ...state, iterations: (state.iterations || 0) + 1 }))
   *   .endWhile()
   * ```
   */
  public while(
    condition: (state: TState) => boolean,
    maxIterations: number = 100
  ): this {
    // Store the condition and mark the start of the loop
    const loopStartIndex = this.flowDefinition.length
    this.loopStack.push(loopStartIndex)

    // Add a placeholder step that will be replaced in endWhile()
    // We store the condition and maxIterations in the placeholder for later use
    interface LoopPlaceholder extends AxFlowStepFunction {
      _condition: (state: TState) => boolean
      _maxIterations: number
      _isLoopStart: boolean
    }

    const placeholderStep: LoopPlaceholder = Object.assign(
      (state: AxFlowState) => state,
      {
        _condition: condition,
        _maxIterations: maxIterations,
        _isLoopStart: true,
      }
    )

    this.flowDefinition.push(placeholderStep)

    return this
  }

  /**
   * Short alias for while()
   */
  public wh(
    condition: (state: TState) => boolean,
    maxIterations: number = 100
  ): this {
    return this.while(condition, maxIterations)
  }

  /**
   * Marks the end of a loop block.
   *
   * @returns this (for chaining)
   */
  public endWhile(): this {
    if (this.loopStack.length === 0) {
      throw new Error('endWhile() called without matching while()')
    }

    const loopStartIndex = this.loopStack.pop()!

    // Get the condition from the placeholder step
    const placeholderStep = this.flowDefinition[loopStartIndex]
    if (!placeholderStep || !('_isLoopStart' in placeholderStep)) {
      throw new Error('Loop start step not found or invalid')
    }

    const condition = (
      placeholderStep as unknown as {
        _condition: (state: TState) => boolean
        _maxIterations: number
      }
    )._condition

    const maxIterations = (
      placeholderStep as unknown as {
        _condition: (state: TState) => boolean
        _maxIterations: number
      }
    )._maxIterations

    // Extract the loop body steps (everything between while and endWhile)
    const loopBodySteps = this.flowDefinition.splice(loopStartIndex + 1)

    // Replace the placeholder with the actual loop implementation
    this.flowDefinition[loopStartIndex] = async (state, context) => {
      let currentState = state
      let iterations = 0

      // Execute the loop while condition is true and within iteration limit
      while (condition(currentState as TState) && iterations < maxIterations) {
        iterations++

        // Execute all steps in the loop body
        for (const step of loopBodySteps) {
          currentState = await step(currentState, context)
        }
      }

      // Check if we exceeded the maximum iterations
      if (iterations >= maxIterations && condition(currentState as TState)) {
        throw new Error(
          `While loop exceeded maximum iterations (${maxIterations}). ` +
            `Consider increasing maxIterations or ensuring the loop condition eventually becomes false.`
        )
      }

      return currentState
    }

    return this
  }

  /**
   * Short alias for endWhile()
   */
  public end(): this {
    return this.endWhile()
  }

  /**
   * Executes the flow with the given AI service and input values.
   *
   * @param ai - The AI service to use as the default for all steps
   * @param values - The input values for the flow
   * @param options - Optional forward options to use as defaults (includes autoParallel override)
   * @returns Promise that resolves to the final output
   */
  public override async forward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions & { autoParallel?: boolean }>
  ): Promise<OUT> {
    // Initialize state with input values
    let state: AxFlowState = { ...values }

    // Create context object
    const context = {
      mainAi: ai,
      mainOptions: options,
    } as const

    // Determine if auto-parallel should be used
    const useAutoParallel =
      options?.autoParallel !== false && this.autoParallelConfig.enabled

    if (useAutoParallel) {
      // Set initial fields for dependency analysis
      this.executionPlanner.setInitialFields(Object.keys(values))

      // Use optimized execution with automatic parallelization
      const optimizedSteps = this.executionPlanner.createOptimizedExecution()
      for (const step of optimizedSteps) {
        state = await step(state, context)
      }
    } else {
      // Use original sequential execution
      for (const step of this.flowDefinition) {
        state = await step(state, context)
      }
    }

    // Return the final state cast to OUT type
    return state as unknown as OUT
  }

  /**
   * Gets execution plan information for debugging automatic parallelization
   *
   * @returns Object with execution plan details
   */
  public getExecutionPlan(): {
    totalSteps: number
    parallelGroups: number
    maxParallelism: number
    autoParallelEnabled: boolean
    steps?: AxFlowExecutionStep[]
    groups?: AxFlowParallelGroup[]
  } {
    const planInfo = this.executionPlanner.getExecutionPlan()
    return {
      totalSteps: planInfo.totalSteps,
      parallelGroups: planInfo.parallelGroups,
      maxParallelism: planInfo.maxParallelism,
      autoParallelEnabled: this.autoParallelConfig.enabled,
      steps: planInfo.steps,
      groups: planInfo.groups,
    }
  }
}

/**
 * Implementation of the sub-context for parallel execution
 */
class AxFlowSubContextImpl implements AxFlowSubContext {
  private readonly steps: AxFlowStepFunction[] = []

  constructor(
    private readonly nodeGenerators: Map<
      string,
      AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
    >
  ) {}

  execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this {
    const nodeProgram = this.nodeGenerators.get(nodeName)
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`)
    }

    this.steps.push(async (state, context) => {
      const ai = dynamicContext?.ai ?? context.mainAi
      const options = dynamicContext?.options ?? context.mainOptions
      const nodeInputs = mapping(state)

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      })

      return {
        ...state,
        [`${nodeName}Result`]: result,
      }
    })

    return this
  }

  map(transform: (state: AxFlowState) => AxFlowState): this {
    this.steps.push((state) => transform(state))
    return this
  }

  async executeSteps(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: AxAIService
      mainOptions?: AxProgramForwardOptions
    }>
  ): Promise<AxFlowState> {
    let currentState = initialState

    for (const step of this.steps) {
      currentState = await step(currentState, context)
    }

    return currentState
  }
}

/**
 * Typed implementation of the sub-context for parallel execution with full type safety
 */
// This class is used by the type system but not directly instantiated in this file
// NOTE: The `any` here is necessary for the same reason as in the interfaces above
export class AxFlowTypedSubContextImpl<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> implements AxFlowTypedSubContext<TNodes, TState>
{
  private readonly steps: AxFlowStepFunction[] = []

  constructor(
    private readonly nodeGenerators: Map<
      string,
      AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
    >
  ) {}

  execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlowTypedSubContext<
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    const nodeProgram = this.nodeGenerators.get(nodeName)
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`)
    }

    this.steps.push(async (state, context) => {
      const ai = dynamicContext?.ai ?? context.mainAi
      const options = dynamicContext?.options ?? context.mainOptions
      const nodeInputs = mapping(state as TState)

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      })

      return {
        ...state,
        [`${nodeName}Result`]: result,
      }
    })

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as AxFlowTypedSubContext<
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >
  }

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState> {
    this.steps.push((state) => transform(state as TState))
    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as unknown as AxFlowTypedSubContext<TNodes, TNewState>
  }

  async executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService
      mainOptions?: AxProgramForwardOptions
    }>
  ): Promise<AxFlowState> {
    let currentState: AxFlowState = initialState

    for (const step of this.steps) {
      currentState = await step(currentState, context)
    }

    return currentState
  }
}
