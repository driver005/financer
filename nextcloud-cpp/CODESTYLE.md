everywhere a few critical critieras have to be met:

  1. we need a default constructor
  2. we need one wihtout optinal / vector etc. only the plain one
  3. one with all!
     -> all have to be defined as rvalues which are moved in!
  4. we need adder function Classnmae& add_name(std::string&& name)
  5. setters void set_name(std::string&& name)
  6. getters std::string& get_name()
  7. const getters const std::string& get_name() const
  8. check that everything is noexcept if no exceptions are throughn if they are throgn please convert into std::except
  9. add const to function that are missing them!
  10. add mebem initilizer pelase std::string m_name{};
  11. use builder pattern if possible pelase but for that consulte me first
